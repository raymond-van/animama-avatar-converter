import { MATERIAL_FLAGS } from "./reader.mjs";

/**
 * PMX materials as glTF materials with VRMC_materials_mtoon.
 */

const LINEAR_REPEAT = { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 };

/** An sRGB colour component (0–1) as linear. */
export function srgbToLinear(c) {
  const v = Math.min(1, Math.max(0, Number.isFinite(c) ? c : 0));
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/**
 * The glTF texture for a PMX texture index, embedding the image on first
 * use; -1 when the texture is missing or unreadable.
 * @param {import("./context.mjs").Context} ctx
 * @param {number} index
 */
export function gltfTexture(ctx, index) {
  if (index < 0 || index >= ctx.textures.length) return -1;
  const texture = ctx.textures[index];
  ctx.usedTextures.add(texture);
  const embedded = texture.embedded();
  if (!embedded) return -1;
  let gltfIndex = ctx.gltfTextures.get(index);
  if (gltfIndex === undefined) {
    const name = texture.stored.replace(/\\/g, "/").split("/").pop()?.replace(/\.[^.]+$/, "") || `texture${index}`;
    const image = ctx.builder.addImage(embedded.bytes, embedded.mimeType, name);
    gltfIndex = ctx.builder.addTexture(image, ctx.builder.addSampler(LINEAR_REPEAT));
    ctx.gltfTextures.set(index, gltfIndex);
  }
  return gltfIndex;
}

/**
 * One glTF material per PMX material, in PMX order.
 * @param {import("./context.mjs").Context} ctx
 * @returns {{gltfIndex: number}[]}
 */
export function buildMaterials(ctx) {
  return ctx.model.materials.map((material) => {
    const texture = gltfTexture(ctx, material.textureIndex);
    const alpha = Math.min(1, Math.max(0, material.diffuse[3]));
    /** @type {Record<string, any>} */
    const pbr = {
      baseColorFactor: [...material.diffuse.slice(0, 3).map(srgbToLinear), alpha],
      metallicFactor: 0,
      roughnessFactor: 1,
    };
    /** @type {Record<string, any>} */
    const mtoon = { specVersion: "1.0", shadeColorFactor: [1, 1, 1] };
    if (texture >= 0) {
      pbr.baseColorTexture = { index: texture };
      mtoon.shadeMultiplyTexture = { index: texture };
    }
    /** @type {Record<string, any>} */
    const gltf = {
      name: material.name || material.nameEn,
      pbrMetallicRoughness: pbr,
      alphaMode: alpha < 1 ? "BLEND" : "OPAQUE",
      doubleSided: (material.flags & MATERIAL_FLAGS.doubleSided) !== 0,
      extensions: { VRMC_materials_mtoon: mtoon },
    };
    ctx.builder.materials.push(gltf);
    return { gltfIndex: ctx.builder.materials.length - 1 };
  });
}
