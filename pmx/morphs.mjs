import { bakeDelta, drop } from "./context.mjs";
import { MORPH_TYPES } from "./reader.mjs";
import { uniqueName } from "./names.mjs";

/**
 * PMX morphs as glTF morph targets. Every vertex morph becomes a target named
 * as in the PMX, because Animama finds MMD faces by morph-target name.
 */

/**
 * @typedef {object} MorphTarget
 * @property {string} name Unique among the mesh's targets.
 * @property {number} source The PMX morph index.
 * @property {Uint32Array} vertices Strictly increasing vertex indices it moves.
 * @property {Float32Array} offsets xyz offset (glTF space) per listed vertex.
 */

/**
 * @param {import("./context.mjs").Context} ctx
 * @returns {MorphTarget[]}
 */
export function buildMorphTargets(ctx) {
  const { model } = ctx;
  const used = new Set();
  /** @type {MorphTarget[]} */
  const targets = [];
  model.morphs.forEach((morph, index) => {
    if (morph.type !== MORPH_TYPES.vertex) {
      const kind = morphKind(morph.type);
      drop(ctx, `${kind} morphs`, 1);
      return;
    }
    /** @type {Map<number, [number, number, number]>} */
    const sums = new Map();
    for (const { vertex, offset } of morph.vertex) {
      const sum = sums.get(vertex) ?? [0, 0, 0];
      sum[0] += offset[0];
      sum[1] += offset[1];
      sum[2] += offset[2];
      sums.set(vertex, sum);
    }
    targets.push(toTarget(ctx, uniqueName(morph.name || morph.nameEn || `morph${index}`, used), index, sums));
  });
  return targets;
}

/**
 * A target from summed PMX offsets (MMD space), moved into glTF space and
 * through the rest-pose bake; zero offsets are left out.
 * @param {import("./context.mjs").Context} ctx
 * @param {string} name
 * @param {number} source
 * @param {Map<number, [number, number, number]>} sums
 * @returns {MorphTarget}
 */
export function toTarget(ctx, name, source, sums) {
  const entries = [...sums.entries()].filter(([, o]) => o[0] !== 0 || o[1] !== 0 || o[2] !== 0).sort((a, b) => a[0] - b[0]);
  const vertices = new Uint32Array(entries.length);
  const offsets = new Float32Array(entries.length * 3);
  entries.forEach(([vertex, o], i) => {
    vertices[i] = vertex;
    offsets.set(bakeDelta(ctx, vertex, [o[0] * ctx.unit, o[1] * ctx.unit, -o[2] * ctx.unit]), i * 3);
  });
  return { name, source, vertices, offsets };
}

/** A readable name for a PMX morph type. */
export function morphKind(type) {
  switch (type) {
    case MORPH_TYPES.group:
      return "group";
    case MORPH_TYPES.bone:
      return "bone";
    case MORPH_TYPES.material:
      return "material";
    case MORPH_TYPES.flip:
      return "flip";
    case MORPH_TYPES.impulse:
      return "impulse";
    case MORPH_TYPES.vertex:
      return "vertex";
    default:
      return "UV";
  }
}
