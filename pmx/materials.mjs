import { drop } from "./context.mjs";
import { MATERIAL_FLAGS } from "./reader.mjs";

/**
 * PMX materials as glTF materials with VRMC_materials_mtoon, reproducing
 * MMD's shading:
 *
 * - MMD lights a material at saturate(diffuse × light + ambient), with the
 *   default light colour 154/255, multiplies the texture, adds an additive
 *   sphere map, and multiplies the toon ramp sampled at
 *   v = 0.5 − 0.5 · dot(N, L) (top row lit, bottom row shadow). A material
 *   without a toon ramp is not shaded.
 * - MMD's edge moves each vertex along its normal by
 *   edgeSize × (camera distance) × 0.001 units at its default 30° field of
 *   view: a nearly constant screen width, about edgeSize × 0.0037 in
 *   normalized device coordinates, drawn unlit. The outline width is
 *   calibrated to three-vrm (the renderer Animama uses), whose MToon offsets
 *   a screen-space outline by its width factor in exactly those units. The
 *   MToon 1.0 specification calls the factor a ratio of the screen height and
 *   UniVRM doubles it, so viewers built on UniVRM draw these outlines twice
 *   as wide as MMD.
 *
 * The formulas follow nanoem as ported by mdanceio (MIT):
 * resources/shaders/model_color.wgsl and src/model/model.rs.
 */

const LINEAR_REPEAT = { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 };

/** MMD's default light colour, (154, 154, 154). */
export const MMD_LIGHT = 154 / 255;

/** Screen-space outline width per unit of PMX edge size (see the module comment). */
export const OUTLINE_PER_EDGE_SIZE = 0.0037;

/** The highest MToon toony factor: a hard step, softened just enough to antialias. */
const MAX_TOONY = 0.95;

/**
 * @typedef {{lit: number[], shade: number[], start: number, end: number}} ToonRamp
 *   sRGB 0–255 colours of the ramp's lit (top) and shadow (bottom) ends, and
 *   where the change between them starts and ends, as fractions of its height.
 */

/**
 * MMD's shared toon ramps toon01–toon10, read from the column MMD samples
 * (x = 0) of the images three.js's MMDLoader embedded (kept by three-stdlib,
 * MIT). Only these values are used; no MMD image is shipped. toon07–toon10
 * are byte-identical to the plain white toon00 there, so they are
 * placeholders that do not shade: a known gap.
 * @type {ToonRamp[]}
 */
export const SHARED_TOONS = [
  { lit: [255, 255, 255], shade: [205, 205, 205], start: 0.5, end: 0.5 },
  { lit: [255, 255, 255], shade: [245, 225, 225], start: 0.5, end: 0.5 },
  { lit: [255, 255, 255], shade: [154, 154, 154], start: 0.5, end: 0.5 },
  { lit: [255, 255, 255], shade: [248, 239, 235], start: 0.5, end: 0.5 },
  { lit: [255, 255, 255], shade: [254, 232, 223], start: 20 / 32, end: 24 / 32 },
  { lit: [255, 237, 97], shade: [195, 172, 3], start: 22 / 32, end: 26 / 32 },
  ...Array.from({ length: 4 }, () => ({ lit: [255, 255, 255], shade: [255, 255, 255], start: 0.5, end: 0.5 })),
];

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** An sRGB colour component (0–1) as linear. */
export function srgbToLinear(c) {
  const v = clamp01(c);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * The glTF texture for a PMX texture index, embedding the image on first
 * use; -1 when it is missing or unusable. Entries naming the same file share
 * one image.
 * @param {import("./context.mjs").Context} ctx
 * @param {number} index
 */
export function gltfTexture(ctx, index) {
  if (index < 0 || index >= ctx.textures.length) return -1;
  const texture = ctx.textures[index];
  ctx.usedTextures.add(texture);
  const embedded = texture.embedded();
  if (!embedded) return -1;
  let gltfIndex = ctx.gltfTextures.get(embedded);
  if (gltfIndex === undefined) {
    const name = texture.stored.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") || `texture${index}`;
    const image = ctx.builder.addImage(embedded.bytes, embedded.mimeType, name);
    gltfIndex = ctx.builder.addTexture(image, ctx.builder.addSampler(LINEAR_REPEAT));
    ctx.gltfTextures.set(embedded, gltfIndex);
  }
  return gltfIndex;
}

/**
 * A toon ramp read from a model's own texture, in the column MMD samples
 * (x = 0): its top and bottom colours and where the change between them
 * runs. The change is found from the shadow upwards, to the nearest lit row,
 * so a bright band elsewhere in the ramp is not taken for its start.
 * @param {import("./images.mjs").RgbaImage} image
 * @returns {ToonRamp}
 */
export function rampOf(image) {
  const at = (y) => Array.from(image.pixels.subarray(y * image.width * 4, y * image.width * 4 + 3));
  const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 2);
  const lit = at(0);
  const shade = at(image.height - 1);
  let last = image.height - 1;
  while (last >= 0 && near(at(last), shade)) last--;
  let first = last;
  while (first >= 0 && !near(at(first), lit)) first--;
  // Rows above first + 1 are lit; rows from last + 1 down are shadow.
  return { lit, shade, start: (first + 1) / image.height, end: (last + 1) / image.height };
}

/**
 * MToon's shading shift and toony factor for a ramp. MMD samples the ramp at
 * v = 0.5 − 0.5 · dot(N, L), so the middle of the change, v, falls where
 * dot(N, L) = 1 − 2v; MToon changes where dot(N, L) + shift = 0, across
 * 2 · (1 − toony) of dot(N, L), which is twice the ramp's width in v.
 * @param {{start: number, end: number}} ramp
 */
export function shadingOf(ramp) {
  const middle = (ramp.start + ramp.end) / 2;
  return {
    shift: Math.max(-1, Math.min(1, 2 * middle - 1)),
    toony: Math.max(0, Math.min(MAX_TOONY, 1 - (ramp.end - ramp.start))),
  };
}

/**
 * The material's toon ramp, or null when it has none (it is then not shaded).
 * A non-shared toon named like a shared one (toon01.bmp …) that the model
 * does not ship is MMD's shared ramp, as MMD loads it from its own folder.
 * @param {import("./context.mjs").Context} ctx
 * @param {import("./reader.mjs").PmxMaterial} material
 * @returns {ToonRamp | null}
 */
function toonOf(ctx, material) {
  if (material.sharedToon) return SHARED_TOONS[material.toonIndex] ?? null;
  const texture = ctx.textures[material.toonIndex];
  if (!texture) return null;
  let ramp = ctx.toonRamps.get(texture);
  if (ramp === undefined) {
    const shared = /(?:^|\/)toon(\d{1,2})\.bmp$/i.exec(texture.stored.replace(/\\/g, "/"));
    const number = shared ? Number(shared[1]) : -1;
    if (texture.file) {
      const image = texture.pixels();
      ramp = image ? rampOf(image) : null;
      if (!image)
        ctx.report.warnings.push(
          `The toon texture '${texture.stored}' could not be read (${/\.jpe?g$/i.test(texture.stored) ? "JPEG toon ramps are not read" : (texture.problem ?? "unreadable")}); its materials are not shaded.`,
        );
    } else if (number === 0) ramp = null; // MMD's toon0.bmp is white: no shading, as in MMD.
    else if (number >= 1 && number <= 10) ramp = SHARED_TOONS[number - 1];
    else {
      ramp = null;
      ctx.usedTextures.add(texture);
    }
    ctx.toonRamps.set(texture, ramp);
  }
  return ramp;
}

/**
 * A PMX material's MToon colours, all linear: the lit colour and alpha, the
 * shade colour, and the outline colour or null for no outline. Material
 * morphs reuse it on a morphed copy of the material.
 * @param {import("./reader.mjs").PmxMaterial} material
 * @param {ToonRamp | null} toon
 */
export function materialColors(material, toon) {
  const base = [0, 1, 2].map((k) => clamp01(material.diffuse[k] * MMD_LIGHT + material.ambient[k]));
  const lit = base.map((v, k) => srgbToLinear(v * (toon ? toon.lit[k] / 255 : 1)));
  const shade = base.map((v, k) => srgbToLinear(v * (toon ? toon.shade[k] / 255 : 1)));
  const edged = (material.flags & MATERIAL_FLAGS.edge) !== 0 && material.edgeSize > 0 && material.edgeColor[3] > 0;
  return {
    lit,
    alpha: clamp01(material.diffuse[3]),
    shade,
    outline: edged ? material.edgeColor.slice(0, 3).map(srgbToLinear) : null,
  };
}

/**
 * @typedef {object} MaterialInfo
 * @property {number} gltfIndex
 * @property {string} alphaMode
 * @property {ToonRamp | null} toon
 */

/**
 * One glTF material per PMX material, in PMX order.
 * @param {import("./context.mjs").Context} ctx
 * @returns {MaterialInfo[]}
 */
export function buildMaterials(ctx) {
  const { model } = ctx;
  let blendCount = 0;
  let specular = 0;
  let translucentEdges = 0;
  const results = model.materials.map((material, index) => {
    const texture = gltfTexture(ctx, material.textureIndex);
    const toon = toonOf(ctx, material);
    const colors = materialColors(material, toon);

    let alphaMode = "OPAQUE";
    if (colors.alpha < 0.999) alphaMode = "BLEND";
    else if (texture >= 0) {
      const usage = ctx.textures[material.textureIndex].alpha();
      alphaMode = usage === "blend" ? "BLEND" : usage === "cutout" ? "MASK" : "OPAQUE";
    }

    /** @type {Record<string, any>} */
    const pbr = { baseColorFactor: [...colors.lit, colors.alpha], metallicFactor: 0, roughnessFactor: 1 };
    const { shift, toony } = toon ? shadingOf(toon) : { shift: 0, toony: MAX_TOONY };
    // MMD draws in material order, writing depth; transparent materials keep that order. A material
    // hidden at rest (alpha 0, shown by a morph) writes no depth, or it would hide what lies behind it.
    const zWrite = alphaMode === "BLEND" && colors.alpha > 0;
    /** @type {Record<string, any>} */
    const mtoon = {
      specVersion: "1.0",
      transparentWithZWrite: zWrite,
      renderQueueOffsetNumber: zWrite ? Math.min(9, blendCount++) : 0,
      shadeColorFactor: colors.shade,
      shadingShiftFactor: shift,
      shadingToonyFactor: toony,
      giEqualizationFactor: 0.9,
      parametricRimColorFactor: [0, 0, 0],
      rimLightingMixFactor: 1,
      parametricRimFresnelPowerFactor: 5,
      parametricRimLiftFactor: 0,
      outlineWidthMode: "none",
    };
    if (texture >= 0) {
      pbr.baseColorTexture = { index: texture };
      mtoon.shadeMultiplyTexture = { index: texture };
    }
    if (material.sphereIndex >= 0 && material.sphereMode === 2) {
      const sphere = gltfTexture(ctx, material.sphereIndex);
      if (sphere >= 0) {
        mtoon.matcapTexture = { index: sphere };
        mtoon.matcapFactor = [1, 1, 1];
      }
    } else if (material.sphereIndex >= 0 && material.sphereMode === 1) drop(ctx, "multiplicative sphere maps (.sph)");
    else if (material.sphereIndex >= 0 && material.sphereMode === 3) drop(ctx, "sub-texture sphere maps");
    if (colors.outline) {
      mtoon.outlineWidthMode = "screenCoordinates";
      mtoon.outlineWidthFactor = OUTLINE_PER_EDGE_SIZE * material.edgeSize;
      mtoon.outlineColorFactor = colors.outline;
      mtoon.outlineLightingMixFactor = 0;
    }
    if (material.specularPower > 0 && material.specular.some((v) => v > 0.001)) specular += 1;
    if (colors.outline && material.edgeColor[3] < 0.999) translucentEdges += 1;

    /** @type {Record<string, any>} */
    const gltf = {
      name: material.name || material.nameEn || `material${index}`,
      pbrMetallicRoughness: pbr,
      alphaMode,
      doubleSided: (material.flags & MATERIAL_FLAGS.doubleSided) !== 0,
      extensions: { VRMC_materials_mtoon: mtoon },
    };
    if (alphaMode === "MASK") gltf.alphaCutoff = 0.5;
    ctx.builder.materials.push(gltf);
    return { gltfIndex: ctx.builder.materials.length - 1, alphaMode, toon };
  });
  drop(ctx, "specular highlights (materials)", specular);
  drop(ctx, "outline transparency (materials, drawn opaque)", translucentEdges);
  // Only vertices of outlined materials lose their per-vertex outline width.
  const edged = new Set();
  let start = 0;
  for (const material of model.materials) {
    if (materialColors(material, null).outline) for (let i = start; i < start + material.indexCount; i++) edged.add(model.indices[i]);
    start += material.indexCount;
  }
  let scaled = 0;
  for (const v of edged) if (Math.abs(model.edgeScales[v] - 1) > 0.01) scaled += 1;
  drop(ctx, "per-vertex outline width (vertices)", scaled);
  return results;
}
