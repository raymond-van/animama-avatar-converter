import { bakeDelta, drop } from "./context.mjs";
import { normalizeName, uniqueName } from "./names.mjs";
import { quatMultiply, quatNormalize, rotate } from "./math.mjs";
import { BONE_FLAGS, MORPH_TYPES } from "./reader.mjs";

/**
 * PMX morphs as glTF morph targets and VRM expression binds.
 *
 * - Every vertex morph is a target named as in the PMX, because Animama finds
 *   MMD faces by morph-target name.
 * - A group morph is expanded with its weights; its vertex and bone parts are
 *   baked into one target named after the group.
 * - A bone morph is baked by skinning the mesh with the bones moved as the
 *   morph moves them at full weight (linear-blend skinning; exact for
 *   translations, approximate for large rotations).
 * - Material parts become colour binds and UV parts that move a whole
 *   material evenly become texture offsets (see `buildExpressions`); other UV,
 *   flip and impulse parts are counted as dropped.
 */

/**
 * @typedef {import("./math.mjs").Vec3} Vec3
 * @typedef {import("./math.mjs").Quat} Quat
 *
 * @typedef {object} MorphTarget
 * @property {string} name Unique among the mesh's targets.
 * @property {number} source The PMX morph index.
 * @property {Uint32Array} vertices Strictly increasing vertex indices it moves.
 * @property {Float32Array} offsets xyz offset (glTF space) per listed vertex.
 *
 * @typedef {object} ExpandedMorph
 * @property {Map<number, [number, number, number]>} vertex Summed offsets (MMD space) per vertex.
 * @property {{bone: number, translation: Vec3, rotation: Quat, weight: number}[]} bone
 * @property {{part: import("./reader.mjs").PmxMaterialOffset, weight: number}[]} material
 * @property {Map<number, [number, number]>} uv Summed UV offsets per vertex.
 * @property {number} other Flip, impulse and additional-UV parts.
 *
 * @typedef {object} MorphPlan
 * @property {ExpandedMorph[]} expanded Per PMX morph.
 * @property {Set<number>} alphaAnimated PMX materials whose alpha a morph changes.
 * @property {Set<number>} revealed Of those, materials hidden at rest that every such morph shows fully.
 */

/**
 * Expand every morph once, before the materials are built: a material whose
 * alpha a morph changes must be drawn blended.
 * @param {import("./context.mjs").Context} ctx
 * @returns {MorphPlan}
 */
export function planMorphs(ctx) {
  const { model } = ctx;
  const expanded = model.morphs.map((_, index) => expand(model, index));
  const alphaAnimated = new Set();
  /** @type {Map<number, boolean>} Per material hidden at rest: whether every morph that changes its alpha shows it fully. */
  const fullReveal = new Map();
  /** @type {Set<object>} Material parts that fade every material at once (each counted once, however many groups use it). */
  const fadesAll = new Set();
  /** @type {Set<object>} Material parts that brighten a texture or toon. */
  const brightens = new Set();
  for (const morph of expanded) {
    /** @type {Map<number, {diffuse: number, tint: number}>} The alpha this morph reaches per material, at full weight. */
    const reached = new Map();
    for (const { part, weight } of morph.material) {
      if (part.operation === 1 && [0, 1, 2].some((k) => part.textureTint[k] > 0 || part.toonTint[k] > 0)) brightens.add(part);
      const changes = part.operation === 0 ? part.diffuse[3] !== 1 || part.textureTint[3] !== 1 : part.diffuse[3] !== 0 || part.textureTint[3] !== 0;
      if (!changes) continue;
      // Blending every material would lose their draw order, so a whole-model fade leaves them opaque.
      if (part.material < 0) {
        fadesAll.add(part);
        continue;
      }
      if (part.material >= model.materials.length) continue;
      alphaAnimated.add(part.material);
      const a = reached.get(part.material) ?? { diffuse: model.materials[part.material].diffuse[3], tint: 1 };
      if (part.operation === 0) {
        a.diffuse *= 1 + (part.diffuse[3] - 1) * weight;
        a.tint *= 1 + (part.textureTint[3] - 1) * weight;
      } else {
        a.diffuse += part.diffuse[3] * weight;
        a.tint += part.textureTint[3] * weight;
      }
      reached.set(part.material, a);
    }
    for (const [m, a] of reached) {
      if (!(model.materials[m].diffuse[3] <= 0.001)) continue;
      const shown = Math.min(1, Math.max(0, a.diffuse)) * Math.min(1, Math.max(0, a.tint));
      fullReveal.set(m, (fullReveal.get(m) ?? true) && shown >= 0.99);
    }
  }
  drop(ctx, "fades of every material at once (the model stays opaque)", fadesAll.size);
  drop(ctx, "material morphs that brighten a texture or toon (VRM colours can only darken them)", brightens.size);
  const revealed = new Set([...fullReveal].filter(([, full]) => full).map(([m]) => m));
  return { expanded, alphaAnimated, revealed };
}

/**
 * @param {import("./reader.mjs").PmxModel} model
 * @param {number} index
 * @returns {ExpandedMorph}
 */
function expand(model, index) {
  /** @type {ExpandedMorph} */
  const out = { vertex: new Map(), bone: [], material: [], uv: new Map(), other: 0 };
  const visit = (m, weight, depth, path) => {
    if (m < 0 || m >= model.morphs.length || depth > 8 || weight === 0 || path.has(m)) return;
    const morph = model.morphs[m];
    switch (morph.type) {
      case MORPH_TYPES.group:
        path.add(m);
        for (const part of morph.group) visit(part.morph, weight * part.weight, depth + 1, path);
        path.delete(m);
        break;
      case MORPH_TYPES.vertex:
        for (const { vertex, offset } of morph.vertex) {
          const sum = out.vertex.get(vertex) ?? [0, 0, 0];
          for (let k = 0; k < 3; k++) sum[k] += offset[k] * weight;
          out.vertex.set(vertex, sum);
        }
        break;
      case MORPH_TYPES.bone:
        for (const part of morph.bone) out.bone.push({ ...part, weight });
        break;
      case MORPH_TYPES.material:
        for (const part of morph.material) out.material.push({ part, weight });
        break;
      case MORPH_TYPES.uv:
        for (const { vertex, offset } of morph.uv) {
          const sum = out.uv.get(vertex) ?? [0, 0];
          sum[0] += offset[0] * weight;
          sum[1] += offset[1] * weight;
          out.uv.set(vertex, sum);
        }
        break;
      default:
        // Flip, impulse and additional-UV parts: VRM has no equivalent.
        out.other += 1;
    }
  };
  visit(index, 1, 0, new Set());
  return out;
}

/**
 * One morph target per PMX morph that moves vertices (directly or through its
 * bones), in PMX order.
 * @param {import("./context.mjs").Context} ctx
 * @param {MorphPlan} plan
 * @returns {MorphTarget[]}
 */
export function buildMorphTargets(ctx, plan) {
  const used = new Set();
  /** @type {MorphTarget[]} */
  const targets = [];
  ctx.model.morphs.forEach((morph, index) => {
    const e = plan.expanded[index];
    /** @type {Map<number, Vec3>} glTF-space offsets per vertex */
    const offsets = new Map();
    for (const [vertex, o] of e.vertex) offsets.set(vertex, bakeDelta(ctx, vertex, [o[0] * ctx.unit, o[1] * ctx.unit, -o[2] * ctx.unit]));
    if (e.bone.length > 0) addBoneOffsets(ctx, e.bone, offsets);
    const entries = [...offsets].filter(([, o]) => o[0] !== 0 || o[1] !== 0 || o[2] !== 0).sort((a, b) => a[0] - b[0]);
    if (entries.length === 0) return;
    const vertices = Uint32Array.from(entries, ([vertex]) => vertex);
    const values = new Float32Array(entries.length * 3);
    entries.forEach(([, o], i) => values.set(o, i * 3));
    targets.push({ name: uniqueName(morph.name || morph.nameEn || `morph${index}`, used), source: index, vertices, offsets: values });
  });
  return targets;
}

/**
 * Add the vertex movement of bone-morph parts: each part turns its bone
 * about the bone's position and moves it, the bones below follow, and every
 * vertex moves with its skin weights.
 * @param {import("./context.mjs").Context} ctx
 * @param {ExpandedMorph["bone"]} parts
 * @param {Map<number, Vec3>} offsets Added to.
 */
function addBoneOffsets(ctx, parts, offsets) {
  /** @type {Map<number, {rotation: Quat, translation: Vec3}>} Each bone's own change, mirrored into glTF's axes, before the rest-pose bake. */
  const own = new Map();
  for (const { bone, translation, rotation, weight } of parts) {
    if (bone < 0 || bone >= ctx.boneCount) continue;
    // MMD's left-handed rotation (x, y, z, w) mirrored across Z is (−x, −y, z, w).
    const r = slerpIdentity(quatNormalize([-rotation[0], -rotation[1], rotation[2], rotation[3]]), weight);
    const t = /** @type {Vec3} */ ([translation[0] * ctx.unit * weight, translation[1] * ctx.unit * weight, -translation[2] * ctx.unit * weight]);
    const previous = own.get(bone);
    own.set(bone, previous ? { rotation: quatMultiply(r, previous.rotation), translation: addv(previous.translation, t) } : { rotation: r, translation: t });
  }
  if (own.size === 0) return;
  // A bone that inherits (付与) another's rotation or move takes that change too, scaled
  // (左目 and 右目 follow 両目). MMD's bones have no rest rotation, so the change carries over as is.
  const { bones } = ctx.model;
  /** @type {Map<number, {rotation: Quat, translation: Vec3} | null>} */
  const memo = new Map();
  const changeOf = (b, depth) => {
    if (memo.has(b)) return memo.get(b) ?? null;
    let change = own.get(b) ?? null;
    const { flags, inheritParent: source, inheritWeight: w } = bones[b];
    const inherits = flags & (BONE_FLAGS.inheritRotation | BONE_FLAGS.inheritTranslation);
    if (inherits && depth < 16 && source >= 0 && source < ctx.boneCount && source !== b && Number.isFinite(w)) {
      const from = changeOf(source, depth + 1);
      if (from) {
        const rotation = flags & BONE_FLAGS.inheritRotation ? slerpIdentity(from.rotation, w) : /** @type {Quat} */ ([0, 0, 0, 1]);
        const translation = /** @type {Vec3} */ (flags & BONE_FLAGS.inheritTranslation ? from.translation.map((v) => v * w) : [0, 0, 0]);
        change = change ? { rotation: quatMultiply(change.rotation, rotation), translation: addv(change.translation, translation) } : { rotation, translation };
      }
    }
    if (depth === 0) memo.set(b, change);
    return change;
  };
  /** @type {Map<number, {rotation: Quat, translation: Vec3}>} Local change per bone, in glTF space (into the baked rest pose). */
  const local = new Map();
  for (let b = 0; b < ctx.boneCount; b++) {
    const change = changeOf(b, 0);
    if (!change) continue;
    const bake = ctx.bakeRotation[b];
    const inverse = /** @type {Quat} */ ([-bake[0], -bake[1], -bake[2], bake[3]]);
    local.set(b, { rotation: quatNormalize(quatMultiply(bake, quatMultiply(change.rotation, inverse))), translation: rotate(bake, change.translation) });
  }
  if (local.size === 0) return;
  /** @type {({rotation: Quat, translation: Vec3} | null)[]} World change per bone: p ↦ R p + t. */
  const world = new Array(ctx.boneCount).fill(null);
  for (const b of ctx.order) {
    const parent = ctx.parent[b] >= 0 ? world[ctx.parent[b]] : null;
    const own = local.get(b);
    if (!own) {
      world[b] = parent;
      continue;
    }
    // Own change about the bone's pivot: p ↦ pivot + R (p − pivot) + t.
    const pivot = ctx.bonePos[b];
    const ownT = addv(subv(pivot, rotate(own.rotation, pivot)), own.translation);
    world[b] = parent
      ? { rotation: quatMultiply(parent.rotation, own.rotation), translation: addv(rotate(parent.rotation, ownT), parent.translation) }
      : { rotation: own.rotation, translation: ownT };
  }
  const { positions, joints, weights } = ctx;
  for (let v = 0; v < positions.length / 3; v++) {
    let moved = false;
    const delta = [0, 0, 0];
    const p = /** @type {Vec3} */ ([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    for (let s = 0; s < 4; s++) {
      const w = weights[v * 4 + s];
      const change = w > 0 ? world[joints[v * 4 + s]] : null;
      if (!change) continue;
      const q = rotate(change.rotation, p);
      for (let k = 0; k < 3; k++) delta[k] += w * (q[k] + change.translation[k] - p[k]);
      moved = true;
    }
    if (!moved) continue;
    const sum = offsets.get(v) ?? [0, 0, 0];
    offsets.set(v, [sum[0] + delta[0], sum[1] + delta[1], sum[2] + delta[2]]);
  }
}

/** The rotation t of the way from identity to q (beyond it for t > 1, backward for t < 0). @returns {Quat} */
function slerpIdentity(q, t) {
  if (t === 1) return q;
  const w = Math.min(1, Math.abs(q[3]));
  const sign = q[3] < 0 ? -1 : 1;
  const angle = 2 * Math.acos(w);
  if (angle < 1e-9) return [0, 0, 0, 1];
  const s = Math.sin(angle / 2);
  const axis = [(q[0] * sign) / s, (q[1] * sign) / s, (q[2] * sign) / s];
  const half = (angle * t) / 2;
  return [axis[0] * Math.sin(half), axis[1] * Math.sin(half), axis[2] * Math.sin(half), Math.cos(half)];
}

const addv = (a, b) => /** @type {Vec3} */ ([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
const subv = (a, b) => /** @type {Vec3} */ ([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);

/**
 * The texture offset a UV morph gives one material, when it moves every
 * vertex that material draws by the same amount; null otherwise.
 * @param {import("./context.mjs").Context} ctx
 * @param {Map<number, [number, number]>} uv
 * @returns {{material: number, offset: [number, number]}[] | null}
 */
export function uniformUvOffsets(ctx, uv) {
  if (uv.size === 0) return null;
  /** @type {{material: number, offset: [number, number]}[]} */
  const found = [];
  const covered = new Set();
  let start = 0;
  for (const [m, material] of ctx.model.materials.entries()) {
    const verts = new Set(ctx.model.indices.subarray(start, start + material.indexCount));
    start += material.indexCount;
    const moved = [...verts].filter((v) => uv.has(v));
    if (moved.length === 0) continue;
    if (moved.length !== verts.size) return null;
    const [du, dv] = /** @type {[number, number]} */ (uv.get(moved[0]));
    if (!moved.every((v) => Math.abs(uv.get(v)[0] - du) < 1e-5 && Math.abs(uv.get(v)[1] - dv) < 1e-5)) return null;
    found.push({ material: m, offset: [du, dv] });
    for (const v of moved) covered.add(v);
  }
  return covered.size === uv.size ? found : null;
}

/** A morph's name normalized for matching (see names.mjs). */
export const morphKey = (morph) => normalizeName(morph.name || morph.nameEn);

/** Count the parts of every morph that VRM cannot express. @param {import("./context.mjs").Context} ctx @param {MorphPlan} plan */
export function countDropped(ctx, plan) {
  ctx.model.morphs.forEach((morph, index) => {
    if (morph.type === MORPH_TYPES.flip) drop(ctx, "flip morphs");
    else if (morph.type === MORPH_TYPES.impulse) drop(ctx, "impulse morphs");
    else if (morph.type >= MORPH_TYPES.uv1 && morph.type <= MORPH_TYPES.uv4) drop(ctx, "additional-UV morphs");
    else if (morph.type === MORPH_TYPES.uv && !uniformUvOffsets(ctx, plan.expanded[index].uv)) drop(ctx, "UV morphs that do not move a whole material evenly");
  });
}
