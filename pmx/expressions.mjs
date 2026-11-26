import { MOOD_PRESETS, MOODS, OVERRIDABLE, REGIONS, composeFace, mergeBinds, regionOfName, regionOfPanel, unstackBones } from "./faces.mjs";
import { materialColors } from "./materials.mjs";
import { normalizeName, uniqueName } from "./names.mjs";
import { uniformUvOffsets } from "./morphs.mjs";
import { BONE_FLAGS, MORPH_TYPES } from "./reader.mjs";
import { drop } from "./context.mjs";
import { isDescendant } from "./humanoid.mjs";

/**
 * The VRMC_vrm expressions: the presets and Animama's per-region parts
 * composed from the face morphs (faces.mjs), a custom expression for every
 * PMX morph that converts, and the user's overrides.
 */

const PRESET_NAMES = new Set(["aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight", "lookUp", "lookDown", "lookLeft", "lookRight", "neutral", ...Object.values(MOOD_PRESETS)]);

/**
 * @param {import("./context.mjs").Context} ctx
 * @param {{plan: import("./morphs.mjs").MorphPlan, targets: import("./morphs.mjs").MorphTarget[], materials: import("./materials.mjs").MaterialInfo[], meshes: {node: number, targets: Map<number, number>}[]}} parts
 */
export function buildExpressions(ctx, { plan, targets, materials, meshes }) {
  const { model, report } = ctx;
  // A target on vertices no face draws is in no mesh: it plays nothing, so no face uses it.
  const shown = new Set(meshes.flatMap((mesh) => [...mesh.targets.keys()]));
  const faceMorphs = faceMorphsOf(ctx, plan, targets, shown);
  const { presets, parts, unstacked } = composeAll(ctx, faceMorphs, (warning) => report.warnings.push(warning));
  if (unstacked.length > 0)
    report.notes.push(
      `Moods whose parts turn the same bones keep one part's turn (brows, then eyes, then mouth), since VRM would add the turns and stretch what they carry; the others play without their bones, or drop out when they move nothing else: ${unstacked
        .map(({ mood, morphs }) => `${MOOD_PRESETS[mood]} (${morphs.map((morph) => (morph.dropped ? `${morph.name}, dropped` : morph.name)).join("; ")})`)
        .join(", ")}.`,
    );
  for (const [name, target] of Object.entries(ctx.lookAtTargets ?? {})) presets[name] = [{ target, weight: 1 }];

  // A target is in every mesh whose vertices it moves, under that mesh's own index.
  const bind = ({ target, weight }) =>
    meshes.flatMap((mesh) => (mesh.targets.has(target) ? [{ node: mesh.node, index: /** @type {number} */ (mesh.targets.get(target)), weight }] : []));
  const expression = (binds, extra = {}) => ({
    ...(binds.some((b) => bind(b).length > 0) ? { morphTargetBinds: binds.flatMap(bind) } : {}),
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
    const found = targetOf.get(index);
    const target = found !== undefined && shown.has(found) ? found : undefined;
    const colorBinds = materialColorBinds(ctx, e, materials);
    const uv = uniformUvOffsets(ctx, e.uv);
    const textureBinds = (uv ?? []).flatMap(({ material, offset }) =>
      [materials[material].gltfIndex, materials[material].edgelessIndex].flatMap((index) => (index === undefined ? [] : [{ material: index, scale: [1, 1], offset }])),
    );
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
    // The material's outline-free copy (faces MMD draws without an edge) changes colour with it.
    const edgeless = materials[m].edgelessIndex;
    const differs = (a, b) => a.some((v, k) => Math.abs(v - b[k]) > 1e-6);
    for (const material of edgeless === undefined ? [gltf] : [gltf, edgeless]) {
      if (differs([...before.lit, before.alpha], [...after.lit, after.alpha]))
        binds.push({ material, type: "color", targetValue: [...after.lit, after.alpha] });
      if (differs(before.shade, after.shade)) binds.push({ material, type: "shadeColor", targetValue: [...after.shade, 1] });
    }
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
 * The presets and parts the face morphs compose (`composeFace`), with the
 * user's overrides, then one bone turn kept per mood (`unstackBones`).
 * @param {import("./context.mjs").Context} ctx
 * @param {ReturnType<typeof faceMorphsOf>} faceMorphs One per target.
 * @param {(warning: string) => void} warn
 */
function composeAll(ctx, faceMorphs, warn) {
  const pmxFaceMorphs = faceMorphs.filter((morph) => !morph.notFace);
  const { presets, parts } = composeFace(pmxFaceMorphs, warn);
  const keep = applyOverrides(ctx.options.expressions ?? [], pmxFaceMorphs, presets, parts);
  const unstacked = unstackBones(presets, parts, pmxFaceMorphs, bonesOverlapIn(ctx), keep);
  return { presets, parts, unstacked };
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
 * @returns {Set<string>} The presets and parts the overrides set.
 */
function applyOverrides(overrides, faceMorphs, presets, parts) {
  const regionOf = new Map(faceMorphs.map((morph) => [morph.target, morph.region]));
  const chosen = new Map();
  for (const override of overrides) {
    if (!OVERRIDABLE.includes(override.name))
      throw new Error(`--expression: "${override.name}" is not a preset or part that can be overridden (${OVERRIDABLE.slice(0, 13).join(", ")}, Fcl_<BRW|EYE|MTH>_<Mood>).`);
    if (chosen.has(override.name)) throw new Error(`--expression ${override.name} is given twice.`);
    if (override.morphs.every((m) => m.weight === 0) && !override.name.startsWith("Fcl_") && !Object.values(MOOD_PRESETS).includes(override.name))
      throw new Error(`--expression ${override.name}= can't leave a blink or vowel empty: Animama would fill it from the model's standard morphs. Name the morphs it should play.`);
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
      for (const region of REGIONS) parts[`Fcl_${region}_${mood}`] = binds.filter((b) => regionOf.get(b.target) === region);
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
  return new Set(chosen.keys());
}

/**
 * The face morphs to compose from: one per target, with its region, side and
 * the bones its PMX morph turns. Targets in `shown` are drawn by some face;
 * the others, and targets no PMX morph names (look-at, bone-free copies), are
 * `notFace`.
 * @param {import("./context.mjs").Context} ctx
 * @param {import("./morphs.mjs").MorphPlan} plan
 * @param {import("./morphs.mjs").MorphTarget[]} targets
 * @param {Set<number>} shown
 */
function faceMorphsOf(ctx, plan, targets, shown) {
  const eyeY = eyeHeight(ctx);
  /** @type {Map<number, number>} Each PMX morph's bone-free copy, by target. */
  const copies = new Map(targets.flatMap((target, index) => (target.boneFreeOf === undefined ? [] : [[target.boneFreeOf, index]])));
  const followers = inheritingBones(ctx);
  const morphs = targets.map((target, index) => {
    const key = normalizeName(target.name);
    if (target.source < 0 || !shown.has(index)) return { target: index, name: target.name, key, region: null, sideX: NaN, notFace: true };
    const { x } = centroid(ctx, target);
    const e = plan.expanded[target.source];
    const bones = turnedBones(ctx, e, followers);
    const copy = copies.get(target.source);
    // A copy that shows plays the morph without its bones; with no vertex part it drops out; with no copy written it stays.
    const boneFree = copy !== undefined && shown.has(copy) ? copy : e.vertex.size === 0 ? null : undefined;
    return {
      target: index,
      name: target.name,
      key,
      region: WHOLE_FACE_NAME.test(target.name) ? "ALL" : (regionOfName(key) ?? regionOfPanel(ctx.model.morphs[target.source].panel) ?? regionOfSpread(ctx, target, eyeY)),
      sideX: x,
      ...(bones.length > 0 ? { bones, boneFree } : {}),
    };
  });
  // A copy is no face morph to compose from, but plays in its morph's region (an emotion's eyes blend the blink).
  const byPmx = new Map(targets.flatMap((target, index) => (target.source >= 0 ? [[target.source, morphs[index]]] : [])));
  return morphs.map((morph, index) => {
    const of = targets[index].boneFreeOf;
    return of === undefined || !byPmx.has(of) ? morph : { ...morph, region: /** @type {any} */ (byPmx.get(of)).region };
  });
}

/**
 * The bones a morph's bone parts turn or move (parts that do neither left
 * out), with every bone that inherits (付与) their change, as the baking does.
 * @param {import("./context.mjs").Context} ctx
 * @param {import("./morphs.mjs").ExpandedMorph} e
 * @param {ReturnType<typeof inheritingBones>} followers
 * @returns {number[]}
 */
function turnedBones(ctx, e, followers) {
  /** @type {Map<number, {turns: boolean, moves: boolean}>} */
  const changes = new Map();
  const add = (bone, turns, moves) => {
    const was = changes.get(bone) ?? { turns: false, moves: false };
    const now = { turns: was.turns || turns, moves: was.moves || moves };
    if (now.turns === was.turns && now.moves === was.moves) return;
    changes.set(bone, now);
    // A follower inherits only the kind of change its flags take.
    for (const { bone: follower, rotation, translation } of followers.get(bone) ?? []) {
      if ((now.turns && rotation) || (now.moves && translation)) add(follower, now.turns && rotation, now.moves && translation);
    }
  };
  for (const { bone, translation, rotation, weight } of e.bone) {
    if (weight === 0 || bone < 0 || bone >= ctx.boneCount) continue;
    const length = Math.hypot(...rotation);
    const turns = length > 0 && Math.abs(rotation[3] / length) < 1 - 1e-9;
    const moves = Math.hypot(...translation) > 1e-9;
    if (turns || moves) add(bone, turns, moves);
  }
  return [...changes.keys()];
}

/**
 * Per bone, the bones that inherit (付与) its rotation or move, and which.
 * @returns {Map<number, {bone: number, rotation: boolean, translation: boolean}[]>}
 */
function inheritingBones(ctx) {
  /** @type {Map<number, {bone: number, rotation: boolean, translation: boolean}[]>} */
  const followers = new Map();
  ctx.model.bones.forEach(({ flags, inheritParent: source, inheritWeight: w }, b) => {
    const rotation = Boolean(flags & BONE_FLAGS.inheritRotation);
    const translation = Boolean(flags & BONE_FLAGS.inheritTranslation);
    if (b >= ctx.boneCount || !(rotation || translation)) return;
    if (source < 0 || source >= ctx.boneCount || source === b || !Number.isFinite(w) || w === 0) return;
    followers.set(source, [...(followers.get(source) ?? []), { bone: b, rotation, translation }]);
  });
  return followers;
}

/**
 * Whether two morphs' bone turns would stack: they turn a bone in common, or
 * one turns a bone below the head that carries the other's (an ear's root and
 * its tip). A turn of the head or a bone above it carries the whole face, so
 * it overlaps only the same bone.
 * @param {import("./context.mjs").Context} ctx
 * @returns {(a: number[], b: number[]) => boolean}
 */
function bonesOverlapIn(ctx) {
  const head = ctx.human.get("head");
  const carriesFace = (bone) => head !== undefined && (bone === head || isDescendant(ctx.parent, head, bone));
  const carries = (upper, lower) => !carriesFace(upper) && isDescendant(ctx.parent, lower, upper);
  return (a, b) => a.some((x) => b.some((y) => x === y || carries(x, y) || carries(y, x)));
}

/**
 * The PMX morphs whose bone-free copies the composed moods will play
 * (`composeFace`), before the meshes are built: copies are written only where
 * a mood needs one. Whether a target shows is judged from the faces' vertices,
 * as the meshes will.
 * @param {import("./context.mjs").Context} ctx
 * @param {import("./morphs.mjs").MorphPlan} plan
 * @param {import("./morphs.mjs").MorphTarget[]} targets
 * @returns {number[]}
 */
export function planBoneFreeCopies(ctx, plan, targets) {
  const drawn = drawnVertices(ctx);
  const shown = new Set(targets.flatMap((target, index) => (target.vertices.some((v) => drawn.has(v)) ? [index] : [])));
  // Each morph with bones and vertices of its own might be played through its copy.
  const faceMorphs = faceMorphsOf(ctx, plan, targets, shown).map((morph) => (morph.bones && morph.boneFree !== null ? { ...morph, boneFree: -1 } : morph));
  const { unstacked } = composeAll(ctx, faceMorphs, () => {});
  return unstacked.flatMap(({ morphs }) => morphs.filter((morph) => !morph.dropped).map((morph) => targets[morph.target].source));
}

/** The vertices the faces draw, as the meshes take them: every triangle in a material's index range that is not degenerate. */
export function drawnVertices(ctx) {
  const { model } = ctx;
  const drawn = new Set();
  let start = 0;
  for (const material of model.materials) {
    for (let f = start; f + 2 < start + material.indexCount; f += 3) {
      const [a, b, c] = [model.indices[f], model.indices[f + 1], model.indices[f + 2]];
      if (a === b || b === c || a === c) continue;
      drawn.add(a).add(b).add(c);
    }
    start += material.indexCount;
  }
  return drawn;
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
