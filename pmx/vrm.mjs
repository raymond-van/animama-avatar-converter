import { humanBoneOrder } from "./humanoid.mjs";

/**
 * The VRMC_vrm extension: metadata, humanoid, first person, expressions and
 * look-at. Adapted from pmx-to-vrm's `Vrm` (MIT).
 */

const LICENSE_URL = "https://vrm.dev/licenses/1.0/";

/**
 * @param {import("./context.mjs").Context} ctx
 * @param {{meshes: {node: number}[]}} parts
 */
export function buildVrm(ctx, { meshes }) {
  const { model, options, report } = ctx;
  /** @type {Record<string, {node: number}>} */
  const humanBones = {};
  for (const bone of humanBoneOrder()) {
    const node = ctx.human.get(bone);
    if (node !== undefined) humanBones[bone] = { node };
  }
  /** @type {Record<string, unknown>} */
  const meta = {
    name: report.model.name,
    authors: [options.author ?? guessAuthor(model.comment) ?? guessAuthor(model.commentEn) ?? "unknown"],
    licenseUrl: LICENSE_URL,
    // VRM's most restrictive defaults, as in the VRChat path.
    avatarPermission: "onlyAuthor",
    allowExcessivelyViolentUsage: false,
    allowExcessivelySexualUsage: false,
    commercialUsage: "personalNonProfit",
    allowPoliticalOrReligiousUsage: false,
    allowAntisocialOrHateUsage: false,
    creditNotation: "required",
    allowRedistribution: false,
    modification: "prohibited",
  };
  if (options.version) meta.version = options.version;
  if (options.copyright) meta.copyrightInformation = options.copyright;
  /** @type {Record<string, unknown>} */
  const vrm = {
    specVersion: "1.0",
    meta,
    humanoid: { humanBones },
    firstPerson: { meshAnnotations: meshes.map(({ node }) => ({ node, type: "auto" })) },
  };
  if (ctx.expressions) vrm.expressions = ctx.expressions;
  if (ctx.lookAt) vrm.lookAt = ctx.lookAt;
  return vrm;
}

/**
 * Credit words, most specific first. Japanese and Chinese ones take a colon
 * or an ideographic space before the name; English ones a colon, or "by".
 */
const CREDIT_KEYS = [
  "モデル製作",
  "モデル制作",
  "模型制作",
  "模型製作",
  "モデリング",
  "モデル作成",
  "建模",
  "制作者",
  "製作者",
  "作者",
  "制作",
  "製作",
  "model by",
  "modeled by",
  "modelled by",
  "created by",
  "made by",
  "author",
  "model",
  "modeling",
  "modelling",
  "改変",
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const CREDIT_PATTERNS = CREDIT_KEYS.map((key) => {
  const separator = / by$/.test(key) ? "\\s*[：:]?\\s*" : /^[a-z]/.test(key) ? "\\s*[：:]\\s*" : "\\s*[：:\\u3000]\\s*";
  return new RegExp(`^${escape(key)}${separator}(.+)$`, "iu");
});

/**
 * The author from a credit line in a PMX comment ("モデル製作：name",
 * "模型制作：name", "Model: name", "made by name"), or null. Keys are tried
 * in priority order, so a model credit wins over an edit credit (改変).
 * @param {string} comment
 */
export function guessAuthor(comment) {
  if (!comment?.trim()) return null;
  const lines = comment.split(/\r?\n/).map((raw) => raw.trim().replace(/^[・*\-■□●○◆◇【[\s]+/u, "").trim());
  for (const pattern of CREDIT_PATTERNS)
    for (const line of lines) {
      const match = pattern.exec(line);
      if (!match) continue;
      const name = match[1].trim().replace(/[】\]\u3000]+$/u, "").trim();
      if (name.length > 0 && name.length <= 80 && !/^https?:/i.test(name)) return name;
    }
  return null;
}
