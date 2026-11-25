import { GltfBuilder } from "./gltf.mjs";
import { rotate } from "./math.mjs";

/**
 * The state one conversion shares between its parts (skeleton, materials,
 * morphs, physics, VRM), and small helpers on it.
 */

/** Metres per MMD unit: MMD's own convention of 8 cm. */
export const MMD_UNIT_METRES = 0.08;

/** The glTF extension that marks Animama Avatar Converter output. */
export const MARKER_EXTENSION = "ANIMAMA_avatar_conversion";

/** A model that cannot be converted (exit status 2). */
export class ConversionError extends Error {}

/**
 * @typedef {import("./math.mjs").Vec3} Vec3
 * @typedef {import("./math.mjs").Quat} Quat
 *
 * @typedef {object} ConvertOptions
 * @property {string} baseDir The `.pmx`'s folder, for textures.
 * @property {string} converterVersion Written into the marker extension.
 * @property {string} [name]
 * @property {string} [version]
 * @property {string} [author]
 * @property {string} [copyright]
 * @property {boolean} [keepPose] Keep MMD's modelled pose instead of the T-pose.
 * @property {string} [fallbackName] The VRM name when neither the options nor the PMX give one (the file's name).
 * @property {{name: string, morphs: {morph: string, weight: number}[]}[]} [expressions] Preset and part overrides (`--expression`).
 *
 * @typedef {object} ConvertReport
 * @property {{name: string, vertices: number, faces: number, materials: number, textures: number, bones: number, heightMetres: number}} model
 * @property {string[]} humanBones Mapped human bones, in VRM order.
 * @property {string[]} missingRequired
 * @property {number} morphTargets
 * @property {{name: string, binds: string[]}[]} expressions
 * @property {{stored: string, problem: string}[]} missingTextures
 * @property {Record<string, number>} dropped Features VRM cannot express, with counts.
 * @property {string[]} [springs] Spring chains, one line each.
 * @property {string} [lookAt] The look-at method, or why there is none.
 * @property {string[]} warnings
 * @property {string[]} notes
 */

/** @param {import("./reader.mjs").PmxModel} model @param {ConvertOptions} options */
export function createContext(model, options) {
  /** @type {ConvertReport} */
  const report = {
    model: {
      name: options.name ?? (model.name.trim() || model.nameEn.trim() || options.fallbackName || "unknown"),
      vertices: model.vertexCount,
      faces: model.indices.length / 3,
      materials: model.materials.length,
      textures: model.textures.length,
      bones: model.bones.length,
      heightMetres: 0,
    },
    humanBones: [],
    missingRequired: [],
    morphTargets: 0,
    expressions: [],
    missingTextures: [],
    dropped: {},
    warnings: [],
    notes: [],
  };
  return {
    model,
    options,
    report,
    unit: MMD_UNIT_METRES,
    builder: new GltfBuilder(),
    boneCount: 0,
    /** @type {Int32Array} */ parent: new Int32Array(0),
    /** @type {number[][]} */ children: [],
    /** @type {number[]} */ order: [],
    /** @type {string[]} */ nodeNames: [],
    /** @type {Vec3[]} */ bonePos: [],
    /** @type {Float32Array} */ positions: new Float32Array(0),
    /** @type {Float32Array} */ normals: new Float32Array(0),
    /** @type {Float32Array} */ uvs: new Float32Array(0),
    /** @type {Uint16Array} */ joints: new Uint16Array(0),
    /** @type {Float32Array} */ weights: new Float32Array(0),
    /** @type {Quat[]} Rest-pose bake rotation per bone. */ bakeRotation: [],
    /** @type {Vec3[]} Rest-pose bake translation per bone. */ bakeTranslation: [],
    /** @type {import("./physics.mjs").Body[]} */ bodies: [],
    /** @type {boolean[]} */ simulated: [],
    /** @type {Map<string, number>} */ human: new Map(),
    /** @type {import("./textures.mjs").TextureFile[]} */ textures: [],
    /** @type {Set<import("./textures.mjs").TextureFile>} */ usedTextures: new Set(),
    /** @type {{name: string, parent: number, position: Vec3}[]} Nodes added after the bones (spring tails). */
    extraNodes: [],
    /** @type {object | null} */ springBone: null,
    /** @type {object | null} VRMC_vrm expressions. */ expressions: null,
    /** @type {object | null} VRMC_vrm look-at. */ lookAt: null,
    /** @type {Record<string, number> | null} The look-at morph target per preset (expression look-at). */ lookAtTargets: null,
    /** @type {Map<object, number>} Embedded image to glTF texture, so entries naming one file share it. */ gltfTextures: new Map(),
    /** @type {Map<object, import("./materials.mjs").ToonRamp | null>} Toon ramp per texture entry. */ toonRamps: new Map(),
  };
}

/** @typedef {ReturnType<typeof createContext>} Context */

/**
 * Count a feature VRM cannot express, for the report.
 * @param {Context} ctx
 * @param {string} feature
 * @param {number} [count]
 */
export function drop(ctx, feature, count = 1) {
  if (count > 0) ctx.report.dropped[feature] = (ctx.report.dropped[feature] ?? 0) + count;
}

/**
 * A PMX position in glTF space.
 * @param {Context} ctx
 * @returns {Vec3}
 */
export function toGltf(ctx, v) {
  return [v[0] * ctx.unit, v[1] * ctx.unit, -v[2] * ctx.unit];
}

/**
 * Rotate a morph offset the way the rest-pose bake rotated vertex v.
 * @param {Context} ctx
 * @param {number} v
 * @param {Vec3} delta
 * @returns {Vec3}
 */
export function bakeDelta(ctx, v, delta) {
  if (ctx.options.keepPose) return delta;
  const out = /** @type {Vec3} */ ([0, 0, 0]);
  for (let s = 0; s < 4; s++) {
    const w = ctx.weights[v * 4 + s];
    if (w <= 0) continue;
    const r = rotate(ctx.bakeRotation[ctx.joints[v * 4 + s]], delta);
    out[0] += w * r[0];
    out[1] += w * r[1];
    out[2] += w * r[2];
  }
  return out;
}

