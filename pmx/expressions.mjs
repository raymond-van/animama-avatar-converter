import { MOOD_PRESETS, MOODS, OVERRIDABLE, REGIONS, composeFace, mergeBinds, regionOfName, regionOfPanel } from "./faces.mjs";
import { materialColors } from "./materials.mjs";
import { normalizeName, uniqueName } from "./names.mjs";
import { uniformUvOffsets } from "./morphs.mjs";
import { MORPH_TYPES } from "./reader.mjs";
import { drop } from "./context.mjs";

/**
 * The VRMC_vrm expressions: the presets and Animama's per-region parts
 * composed from the face morphs (faces.mjs), a custom expression for every
 * PMX morph that converts, and the user's overrides.
 */

const PRESET_NAMES = new Set(["aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight", "lookUp", "lookDown", "lookLeft", "lookRight", "neutral", ...Object.values(MOOD_PRESETS)]);

/**
 * @param {import("./context.mjs").Context} ctx
 * @param {{plan: import("./morphs.mjs").MorphPlan, targets: import("./morphs.mjs").MorphTarget[], materials: import("./materials.mjs").MaterialInfo[], meshNode: number}} parts
 */
export function buildExpressions(ctx, { plan, targets, materials, meshNode }) {
  const { model, report } = ctx;
  const eyeY = eyeHeight(ctx);
  const faceMorphs = targets.map((target, index) => {
    const key = normalizeName(target.name);
    // The look-at's own targets (no PMX morph) are not face morphs to compose from.
    if (target.source < 0) return { target: index, name: target.name, key, region: null, sideX: NaN, lookAt: true };
    const { x, y } = centroid(ctx, target);
    return {
      target: index,
      name: target.name,
      key,
      region: WHOLE_FACE_NAME.test(target.name) ? "ALL" : (regionOfName(key) ?? regionOfPanel(model.morphs[target.source].panel) ?? regionOfSpread(ctx, target, eyeY)),
      sideX: x,
    };
  });
  const pmxFaceMorphs = faceMorphs.filter((morph) => !morph.lookAt);
  const { presets, parts } = composeFace(pmxFaceMorphs, (warning) => report.warnings.push(warning));
  applyOverrides(ctx.options.expressions ?? [], pmxFaceMorphs, presets, parts);
  for (const [name, target] of Object.entries(ctx.lookAtTargets ?? {})) presets[name] = [{ target, weight: 1 }];

  const bind = ({ target, weight }) => ({ node: meshNode, index: target, weight });
  const expression = (binds, extra = {}) => ({
    ...(binds.length > 0 ? { morphTargetBinds: binds.map(bind) } : {}),
    isBinary: false,
    overrideBlink: "none",
    overrideLookAt: "none",
    overrideMouth: "none",
    ...extra,
  });

  /** @type {Record<string, object>} */
  const preset = {};
  for (const [name, binds] of Object.entries(presets)) {
    // An emotion that moves the eyes would double up with a blink on top.
    const movesEyes = Object.values(MOOD_PRESETS).includes(name) && binds.some((b) => ["EYE", "ALL"].includes(/** @type {string} */ (faceMorphs[b.target].region)));
    // With look-at by expression, the turned iris would cross a closed lid.
    const closesEyes = ctx.lookAtTargets !== null && ["blink", "blinkLeft", "blinkRight"].includes(name);
    preset[name] = expression(binds, { ...(movesEyes ? { overrideBlink: "blend" } : {}), ...(closesEyes ? { overrideLookAt: "block" } : {}) });
  }

  /** @type {Record<string, object>} */
  const custom = {};
  for (const [name, binds] of Object.entries(parts)) custom[name] = expression(binds);
  // Every converted PMX morph under its own name, for apps that list expressions
  // (Animama registers morph targets by name itself; material and UV morphs reach it only this way).
  const targetOf = new Map(targets.map((target, index) => [target.source, index]));
  const taken = new Set([...PRESET_NAMES, ...Object.keys(custom)]);
  const presetOrPart = new Set(taken);
  let showsNothing = 0;
  model.morphs.forEach((morph, index) => {
    let name = morph.name || morph.nameEn;
    const e = plan.expanded[index];
    const target = targetOf.get(index);
    const colorBinds = materialColorBinds(ctx, e, materials);
    const uv = uniformUvOffsets(ctx, e.uv);
    const textureBinds = (uv ?? []).map(({ material, offset }) => ({ material: materials[material].gltfIndex, scale: [1, 1], offset }));
    if (target === undefined && colorBinds.length === 0 && textureBinds.length === 0) {
      // UV, flip and impulse morphs are already counted by kind.
      const brightens = e.material.some(({ part }) => part.operation === 1 && [0, 1, 2].some((k) => part.textureTint[k] > 0 || part.toonTint[k] > 0));
      if (![MORPH_TYPES.uv, MORPH_TYPES.flip, MORPH_TYPES.impulse].includes(morph.type) && e.uv.size === 0 && e.other === 0 && !brightens) showsNothing += 1;
      return;
    }
    if (!name || presetOrPart.has(name)) return;
    // A second morph of the same name is listed under its target's name (あ_2).
    if (taken.has(name)) name = uniqueName(target !== undefined ? targets[target].name : name, taken);
    custom[name] = expression(target === undefined ? [] : [{ target, weight: 1 }], {
      ...(colorBinds.length > 0 ? { materialColorBinds: colorBinds } : {}),
      ...(textureBinds.length > 0 ? { textureTransformBinds: textureBinds } : {}),
    });
    taken.add(name);
  });
  drop(ctx, "morphs that change nothing VRM can show (no offsets, or bones and materials outside the model)", showsNothing);

  report.expressions = describe(presets, parts, targets);
  ctx.expressions = { preset, custom };
}

/**
 * The colours a morph's material parts reach at full weight, as VRM binds.
 * MMD applies the parts in order: multiply scales a value toward the
 * offset (v × lerp(1, o, w)), add adds it (v + o × w).
 * @param {import("./context.mjs").Context} ctx
 * @param {import("./morphs.mjs").ExpandedMorph} e
 * @param {import("./materials.mjs").MaterialInfo[]} materials
 */
function materialColorBinds(ctx, e, materials) {
  const { model } = ctx;
  /** @type {Map<number, import("./reader.mjs").PmxMaterial>} */
  const changed = new Map();
  for (const { part, weight } of e.material) {
    const indices = part.material < 0 ? model.materials.map((_, m) => m) : [part.material];
    for (const m of indices) {
      if (m < 0 || m >= model.materials.length) continue;
      const copy = changed.get(m) ?? structuredClone(model.materials[m]);
      applyMaterialOffset(copy, part, weight);
      changed.set(m, copy);
    }
  }
  const binds = [];
  for (const [m, copy] of [...changed].sort((a, b) => a[0] - b[0])) {
    const before = materialColors(model.materials[m], materials[m].toon);
    const after = materialColors(copy, materials[m].toon);
    const gltf = materials[m].gltfIndex;
    const differs = (a, b) => a.some((v, k) => Math.abs(v - b[k]) > 1e-6);
    if (differs([...before.lit, before.alpha], [...after.lit, after.alpha]))
      binds.push({ material: gltf, type: "color", targetValue: [...after.lit, after.alpha] });
    if (differs(before.shade, after.shade)) binds.push({ material: gltf, type: "shadeColor", targetValue: [...after.shade, 1] });
    if (before.outline && after.outline && differs(before.outline, after.outline))
      binds.push({ material: gltf, type: "outlineColor", targetValue: [...after.outline, 1] });
  }
  return binds;
}

/**
 * Apply one PMX material-morph part to a material copy. The texture and toon
 * tints start at 1 and are kept on the copy (`textureTint`, `toonTint`):
 * MMD multiplies the whole lit colour by the tinted texture and toon, which
 * `materialColors` does with them.
 * @param {import("./reader.mjs").PmxMaterial & {textureTint?: number[], toonTint?: number[]}} material
 * @param {import("./reader.mjs").PmxMaterialOffset} o
 * @param {number} w
 */
export function applyMaterialOffset(material, o, w) {
  const textureTint = material.textureTint ?? [1, 1, 1, 1];
  const toonTint = material.toonTint ?? [1, 1, 1, 1];
  if (o.operation === 0) {
    const toward = (value, factor) => value * (1 + (factor - 1) * w);
    material.diffuse = /** @type {any} */ (material.diffuse.map((v, k) => toward(v, o.diffuse[k])));
    material.ambient = /** @type {any} */ (material.ambient.map((v, k) => toward(v, o.ambient[k])));
    material.edgeColor = /** @type {any} */ (material.edgeColor.map((v, k) => toward(v, o.edgeColor[k])));
    material.edgeSize = toward(material.edgeSize, o.edgeSize);
    material.textureTint = textureTint.map((v, k) => toward(v, o.textureTint[k]));
    material.toonTint = toonTint.map((v, k) => toward(v, o.toonTint[k]));
  } else {
    material.diffuse = /** @type {any} */ (material.diffuse.map((v, k) => v + o.diffuse[k] * w));
    material.ambient = /** @type {any} */ (material.ambient.map((v, k) => v + o.ambient[k] * w));
    material.edgeColor = /** @type {any} */ (material.edgeColor.map((v, k) => v + o.edgeColor[k] * w));
    material.edgeSize += o.edgeSize * w;
    material.textureTint = textureTint.map((v, k) => v + o.textureTint[k] * w);
    material.toonTint = toonTint.map((v, k) => v + o.toonTint[k] * w);
  }
}

/**
 * Replace presets' and region parts' binds with the user's choice. A mood keeps
 * VRoid's shape, where the preset, `Fcl_ALL_<Mood>` and the three region parts
 * agree: a region override recomposes its mood, and a mood override splits
 * into the regions by each morph's region. A neutral override writes an empty
 * expression rather than none, so an app does not fill it from the morph names.
 * @param {{name: string, morphs: {morph: string, weight: number}[]}[]} overrides
 * @param {{target: number, name: string, region: string | null}[]} faceMorphs
 * @param {Record<string, {target: number, weight: number}[]>} presets
 * @param {Record<string, {target: number, weight: number}[]>} parts
 */
function applyOverrides(overrides, faceMorphs, presets, parts) {
  const chosen = new Map();
  for (const override of overrides) {
    if (!OVERRIDABLE.includes(override.name))
      throw new Error(`--expression: "${override.name}" is not a preset or part that can be overridden (${OVERRIDABLE.slice(0, 13).join(", ")}, Fcl_<BRW|EYE|MTH>_<Mood>).`);
    if (chosen.has(override.name)) throw new Error(`--expression ${override.name} is given twice.`);
    chosen.set(
      override.name,
      mergeBinds(
        override.morphs.map(({ morph, weight }) => {
          const key = normalizeName(morph);
          const found = faceMorphs.find((m) => m.name === morph) ?? faceMorphs.find((m) => normalizeName(m.name) === key);
          if (!found) throw new Error(`--expression ${override.name}: the model has no face morph named "${morph}" (material-only and UV morphs cannot be chosen).`);
          return { target: found.target, weight };
        }),
      ),
    );
  }
  for (const mood of MOODS) {
    const preset = MOOD_PRESETS[mood];
    const regions = REGIONS.filter((region) => chosen.has(`Fcl_${region}_${mood}`));
    if (chosen.has(preset) && regions.length > 0)
      throw new Error(`--expression ${preset} and Fcl_${regions[0]}_${mood} both set the ${preset} face; give one or the other.`);
    if (chosen.has(preset)) {
      const binds = chosen.get(preset);
      for (const region of REGIONS) parts[`Fcl_${region}_${mood}`] = binds.filter((b) => faceMorphs[b.target].region === region);
      presets[preset] = binds;
      parts[`Fcl_ALL_${mood}`] = binds;
    } else if (regions.length > 0) {
      for (const region of regions) parts[`Fcl_${region}_${mood}`] = chosen.get(`Fcl_${region}_${mood}`);
      const whole = mergeBinds(REGIONS.flatMap((region) => parts[`Fcl_${region}_${mood}`] ?? []));
      presets[preset] = whole;
      parts[`Fcl_ALL_${mood}`] = whole;
    }
  }
  for (const [name, binds] of chosen) if (!name.startsWith("Fcl_") && !Object.values(MOOD_PRESETS).includes(name)) presets[name] = binds;
}

/** The report's lines: each preset and part with the morphs it plays. */
function describe(presets, parts, targets) {
  const list = (binds) => binds.map(({ target, weight }) => (weight === 1 ? targets[target].name : `${targets[target].name}×${Math.round(weight * 100) / 100}`));
  const lines = [];
  for (const name of ["aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight"])
    lines.push({ name, binds: presets[name] ? list(presets[name]) : [] });
  for (const mood of MOODS) {
    const regions = REGIONS.map((region) => {
      const binds = parts[`Fcl_${region}_${mood}`];
      return `${{ BRW: "brows", EYE: "eyes", MTH: "mouth" }[region]} ${binds?.length ? list(binds).join("+") : "—"}`;
    });
    // A morph chosen for a mood whose region is unknown plays only in the preset.
    const inRegions = new Set(REGIONS.flatMap((region) => (parts[`Fcl_${region}_${mood}`] ?? []).map((b) => b.target)));
    const other = (presets[MOOD_PRESETS[mood]] ?? []).filter((b) => !inRegions.has(b.target));
    if (other.length > 0) regions.push(`other ${list(other).join("+")}`);
    lines.push({ name: MOOD_PRESETS[mood], binds: [regions.join(", ")] });
  }
  return lines;
}

/** The height of the eyes: the eye bones, else the head bone plus 6 cm, else NaN. */
function eyeHeight(ctx) {
  const eyes = ["leftEye", "rightEye"].map((bone) => ctx.human.get(bone)).filter((b) => b !== undefined);
  if (eyes.length > 0) return eyes.reduce((sum, b) => sum + ctx.bonePos[b][1], 0) / eyes.length;
  const head = ctx.human.get("head");
  return head === undefined ? NaN : ctx.bonePos[head][1] + 0.06;
}

/** The face region at a height, against the eyes. */
function regionOfHeight(y, eyeY) {
  if (Number.isNaN(y) || Number.isNaN(eyeY)) return null;
  if (y > eyeY + 0.02) return "BRW";
  if (y > eyeY - 0.025) return "EYE";
  return "MTH";
}

/**
 * A morph's region from where the vertices it moves sit, weighted by how far
 * they move: "ALL" when the mouth and the eyes or brows each hold a fifth of
 * the movement or more (a whole-face morph), else the region with the most.
 * Eyes and brows together are not the whole face: large eyes reach the brows' band.
 */
function regionOfSpread(ctx, target, eyeY) {
  if (Number.isNaN(eyeY)) return null;
  /** @type {Record<string, number>} */
  const share = { BRW: 0, EYE: 0, MTH: 0 };
  let total = 0;
  target.vertices.forEach((v, i) => {
    const w = Math.hypot(target.offsets[i * 3], target.offsets[i * 3 + 1], target.offsets[i * 3 + 2]);
    share[/** @type {string} */ (regionOfHeight(ctx.positions[v * 3 + 1], eyeY))] += w;
    total += w;
  });
  if (!(total > 1e-12)) return null;
  if (share.MTH >= 0.2 * total && share.BRW + share.EYE >= 0.2 * total) return "ALL";
  const ranked = Object.entries(share).sort((a, b) => b[1] - a[1]);
  return /** @type {"BRW" | "EYE" | "MTH"} */ (ranked[0][0]);
}

/** A name that says it is the whole face: Fcl_ALL_Joy, all_smile … */
const WHOLE_FACE_NAME = /(^|[^a-z])all([^a-z]|$)/i;

/** The mean position of the vertices a target moves, weighted by how far. */
function centroid(ctx, target) {
  let x = 0;
  let y = 0;
  let total = 0;
  target.vertices.forEach((v, i) => {
    const w = Math.hypot(target.offsets[i * 3], target.offsets[i * 3 + 1], target.offsets[i * 3 + 2]);
    x += ctx.positions[v * 3] * w;
    y += ctx.positions[v * 3 + 1] * w;
    total += w;
  });
  return total > 1e-12 ? { x: x / total, y: y / total } : { x: NaN, y: NaN };
}
