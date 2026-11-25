import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { convertPmx } from "./convert.mjs";
import { readGlb } from "./gltf.mjs";
import { createImage, encodePng } from "./images.mjs";
import { MMD_LIGHT, OUTLINE_PER_EDGE_SIZE, SHARED_TOONS, rampOf, shadingOf, srgbToLinear } from "./materials.mjs";
import { MATERIAL_FLAGS } from "./reader.mjs";
import { syntheticHumanoid, writeModelFolder } from "./testing/synthetic.mjs";

async function convert(parts) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pmx-materials-"));
  const file = await writeModelFolder(dir, parts);
  const result = convertPmx(new Uint8Array(await readFile(file)), { baseDir: dir, converterVersion: "test" });
  return { ...result, ...readGlb(result.glb) };
}

/** A PNG whose alpha is opaque except for the given value in its first `count` pixels. */
function pngWithAlpha(alpha, count) {
  const image = createImage(10, 10);
  image.pixels.fill(255);
  for (let i = 0; i < count; i++) image.pixels[i * 4 + 3] = alpha;
  return new Uint8Array(encodePng(image));
}

const close = (actual, expected, eps = 1e-6) =>
  assert.ok(
    actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) < eps),
    `${JSON.stringify(actual)} ≉ ${JSON.stringify(expected)}`,
  );
const mtoonOf = (json, name) => {
  const material = json.materials.find((m) => m.name === name);
  return { material, mtoon: material.extensions.VRMC_materials_mtoon };
};

test("lights the base colour as MMD does: diffuse × light + ambient, clamped, then linear", async () => {
  const parts = syntheticHumanoid();
  Object.assign(parts.model.materials[0], { diffuse: [0.5, 0.2, 1, 1], ambient: [0.2, 0.1, 0.8] });
  const { json } = await convert(parts);
  const { material } = mtoonOf(json, "体");
  const expected = [0.5 * MMD_LIGHT + 0.2, 0.2 * MMD_LIGHT + 0.1, 1].map(srgbToLinear);
  close(material.pbrMetallicRoughness.baseColorFactor, [...expected, 1]);
});

test("shades with the dark end of a shared toon ramp, at its step", async () => {
  const parts = syntheticHumanoid();
  Object.assign(parts.model.materials[1], { sharedToon: true, toonIndex: 1, diffuse: [1, 1, 1, 1], ambient: [0, 0, 0] });
  const { json } = await convert(parts);
  const { mtoon } = mtoonOf(json, "髪");
  const lit = srgbToLinear(MMD_LIGHT);
  close(mtoon.shadeColorFactor, SHARED_TOONS[1].shade.map((c) => srgbToLinear((MMD_LIGHT * c) / 255)));
  assert.ok(mtoon.shadeColorFactor[0] > mtoon.shadeColorFactor[1], "toon02 shadows are warm");
  assert.ok(mtoon.shadeColorFactor[0] < lit);
  assert.equal(mtoon.shadingShiftFactor, 0);
  assert.equal(mtoon.shadingToonyFactor, 0.95);
});

test("reads a model's own toon texture, and leaves a toon-less material unshaded", async () => {
  const parts = syntheticHumanoid();
  Object.assign(parts.model.materials[0], { diffuse: [1, 1, 1, 1], ambient: [0, 0, 0] });
  Object.assign(parts.model.materials[1], { sharedToon: false, toonIndex: -1 });
  const { json } = await convert(parts);
  const body = mtoonOf(json, "体").mtoon;
  // toon_body.bmp: white above, (200, 160, 150) below the middle.
  close(body.shadeColorFactor, [200, 160, 150].map((c) => srgbToLinear((MMD_LIGHT * c) / 255)));
  assert.equal(body.shadingShiftFactor, 0);
  const hair = mtoonOf(json, "髪");
  close(hair.mtoon.shadeColorFactor, hair.material.pbrMetallicRoughness.baseColorFactor.slice(0, 3));
});

test("uses MMD's shared ramp for a toon01.bmp the model does not ship", async () => {
  const parts = syntheticHumanoid();
  parts.model.textures[1] = "toon01.bmp";
  const { json, report } = await convert(parts);
  const { material, mtoon } = mtoonOf(json, "体");
  const lit = material.pbrMetallicRoughness.baseColorFactor;
  assert.ok(mtoon.shadeColorFactor[0] < lit[0]);
  assert.ok(!report.missingTextures.some((t) => t.stored === "toon01.bmp"));
});

test("derives shading shift and toony factor from the ramp's change", () => {
  assert.deepEqual(shadingOf({ start: 0.5, end: 0.5 }), { shift: 0, toony: 0.95 });
  const gradient = shadingOf({ start: 18 / 32, end: 31 / 32 });
  assert.ok(Math.abs(gradient.shift - (2 * (49 / 64) - 1)) < 1e-9);
  assert.ok(Math.abs(gradient.toony - (1 - 13 / 32)) < 1e-9);
  const ramp = createImage(1, 8);
  for (let y = 0; y < 8; y++) ramp.pixels.set(y < 6 ? [255, 255, 255, 255] : [100, 90, 80, 255], y * 4);
  assert.deepEqual(rampOf(ramp), { lit: [255, 255, 255], shade: [100, 90, 80], start: 0.75, end: 0.75 });
});

test("draws an unlit, screen-space outline from the edge settings", async () => {
  const parts = syntheticHumanoid();
  Object.assign(parts.model.materials[0], { edgeSize: 0.5, edgeColor: [0.5, 0.2, 0, 1] });
  Object.assign(parts.model.materials[1], { flags: MATERIAL_FLAGS.edge, edgeSize: 1, edgeColor: [0, 0, 0, 0] });
  const { json } = await convert(parts);
  const { mtoon } = mtoonOf(json, "体");
  assert.equal(mtoon.outlineWidthMode, "screenCoordinates");
  assert.ok(Math.abs(mtoon.outlineWidthFactor - 0.5 * OUTLINE_PER_EDGE_SIZE) < 1e-12);
  close(mtoon.outlineColorFactor, [0.5, 0.2, 0].map(srgbToLinear));
  assert.equal(mtoon.outlineLightingMixFactor, 0);
  assert.equal(mtoonOf(json, "髪").mtoon.outlineWidthMode, "none", "a fully transparent edge colour draws no outline");
});

test("chooses blend, cutout or opaque, and keeps transparent materials in PMX order", async () => {
  const parts = syntheticHumanoid();
  parts.files["cut.png"] = pngWithAlpha(0, 30);
  parts.files["soft.png"] = pngWithAlpha(128, 30);
  parts.model.textures.push("cut.png", "soft.png");
  const { model } = parts;
  model.materials[0].textureIndex = 2; // cut.png
  model.materials[1].diffuse = [1, 1, 1, 1];
  model.materials[1].textureIndex = 3; // soft.png
  const { json } = await convert(parts);
  const body = mtoonOf(json, "体");
  assert.equal(body.material.alphaMode, "MASK");
  assert.equal(body.material.alphaCutoff, 0.5);
  const hair = mtoonOf(json, "髪");
  assert.equal(hair.material.alphaMode, "BLEND");
  assert.equal(hair.mtoon.transparentWithZWrite, true);
  assert.equal(hair.mtoon.renderQueueOffsetNumber, 0);
  const faded = syntheticHumanoid();
  faded.model.materials[0].diffuse[3] = 0.5;
  const twoBlends = (await convert(faded)).json;
  assert.deepEqual(
    twoBlends.materials.map((m) => [m.alphaMode, m.extensions.VRMC_materials_mtoon.renderQueueOffsetNumber]),
    [
      ["BLEND", 0],
      ["BLEND", 1],
    ],
  );
});

test("turns an additive sphere map into a matcap and counts what MToon cannot draw", async () => {
  const parts = syntheticHumanoid();
  parts.files["glow.spa"] = pngWithAlpha(255, 0);
  parts.files["shine.sph"] = pngWithAlpha(255, 0);
  parts.model.textures.push("glow.spa", "shine.sph");
  Object.assign(parts.model.materials[0], { sphereIndex: 2, sphereMode: 2, specular: [0.3, 0.3, 0.3], specularPower: 10 });
  Object.assign(parts.model.materials[1], { sphereIndex: 3, sphereMode: 1 });
  parts.model.edgeScales[0] = 1.5;
  const { json, report } = await convert(parts);
  const { mtoon } = mtoonOf(json, "体");
  assert.ok(mtoon.matcapTexture.index >= 0);
  assert.deepEqual(mtoon.matcapFactor, [1, 1, 1]);
  assert.equal(mtoonOf(json, "髪").mtoon.matcapTexture, undefined);
  assert.equal(report.dropped["multiplicative sphere maps (.sph)"], 1);
  assert.equal(report.dropped["specular highlights (materials)"], 1);
  assert.equal(report.dropped["per-vertex outline width (vertices)"], 1);
});

test("embeds one image for texture entries that name the same file", async () => {
  const parts = syntheticHumanoid();
  parts.model.textures.push("TEX/BODY.BMP");
  parts.model.materials[1].textureIndex = 2;
  const { json } = await convert(parts);
  assert.equal(json.images.length, 1);
  const textureOf = (name) => json.materials.find((m) => m.name === name).pbrMetallicRoughness.baseColorTexture.index;
  assert.equal(textureOf("体"), textureOf("髪"));
});

test("a material hidden at rest writes no depth, so it cannot hide what lies behind it", async () => {
  const parts = syntheticHumanoid();
  parts.model.materials[0].diffuse[3] = 0;
  const { json } = await convert(parts);
  const body = mtoonOf(json, "体");
  assert.equal(body.material.alphaMode, "BLEND");
  assert.equal(body.mtoon.transparentWithZWrite, false);
  assert.equal(body.mtoon.renderQueueOffsetNumber, 0);
  // The hair, also blended (alpha 0.9), is the first transparent material that writes depth.
  assert.equal(mtoonOf(json, "髪").mtoon.renderQueueOffsetNumber, 0);
  assert.equal(mtoonOf(json, "髪").mtoon.transparentWithZWrite, true);
});

test("reads a ramp from the column MMD samples, from its shadow up to the nearest lit row", () => {
  const ramp = createImage(2, 8);
  // Column 0: white, a bright band, white, then the shadow; column 1 is a decoy.
  const column0 = [[255, 255, 255], [255, 255, 200], [255, 255, 255], [255, 255, 255], [255, 255, 255], [200, 200, 200], [100, 100, 100], [100, 100, 100]];
  column0.forEach((rgb, y) => {
    ramp.pixels.set([...rgb, 255], y * 8);
    ramp.pixels.set([0, 0, 0, 255], y * 8 + 4);
  });
  assert.deepEqual(rampOf(ramp), { lit: [255, 255, 255], shade: [100, 100, 100], start: 5 / 8, end: 6 / 8 });
});

test("treats an unshipped toon0.bmp as no toon, and reports an unreadable toon", async () => {
  const parts = syntheticHumanoid();
  parts.model.textures[1] = "toon0.bmp";
  const unshipped = await convert(parts);
  const body = mtoonOf(unshipped.json, "体");
  close(body.mtoon.shadeColorFactor, body.material.pbrMetallicRoughness.baseColorFactor.slice(0, 3));
  assert.ok(!unshipped.report.missingTextures.some((t) => t.stored === "toon0.bmp"));
  const broken = syntheticHumanoid();
  broken.files["toon_body.bmp"] = new Uint8Array(Buffer.from("BM not really a bitmap"));
  const { report } = await convert(broken);
  assert.ok(report.warnings.some((w) => /toon texture 'toon_body.bmp' could not be read/.test(w)));
});

test("embeds a PNG the decoder cannot read as it is, without calling it missing", async () => {
  const parts = syntheticHumanoid();
  const png = Buffer.from(pngWithAlpha(255, 0));
  png[png.indexOf("IDAT") + 6] ^= 0xff; // corrupt the compressed data, keep the signature
  parts.files["broken.png"] = new Uint8Array(png);
  parts.model.textures.push("broken.png");
  parts.model.materials[1].textureIndex = 2;
  const { json, report } = await convert(parts);
  assert.ok(json.images.some((image) => image.name === "broken" && image.mimeType === "image/png"));
  assert.ok(!report.missingTextures.some((t) => t.stored === "broken.png"));
  assert.equal(mtoonOf(json, "髪").material.alphaMode, "BLEND", "the hair's own diffuse alpha still decides");
});

test("counts translucent edges and the edge scale of outlined vertices only", async () => {
  const parts = syntheticHumanoid();
  parts.model.materials[0].edgeColor = [0, 0, 0, 0.5];
  // Vertex 0 is on the outlined body; the last vertex is on the hair, which has no outline.
  parts.model.edgeScales[0] = 2;
  parts.model.edgeScales[parts.model.vertexCount - 1] = 2;
  const { report } = await convert(parts);
  assert.equal(report.dropped["outline transparency (materials, drawn opaque)"], 1);
  assert.equal(report.dropped["per-vertex outline width (vertices)"], 1);
});
