import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConversionError, MARKER_EXTENSION, convertPmx } from "./convert.mjs";
import { readGlb } from "./gltf.mjs";
import { BONES, syntheticHumanoid, writeModelFolder } from "./testing/synthetic.mjs";
import { writePmx } from "./testing/writer.mjs";
import { guessAuthor } from "./vrm.mjs";

/** Convert a synthetic model written to a temporary folder with its textures. */
async function convert(parts = syntheticHumanoid(), options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pmx-convert-"));
  const file = await writeModelFolder(dir, parts);
  const result = convertPmx(new Uint8Array(await readFile(file)), { baseDir: dir, converterVersion: "9.9.9", ...options });
  return { ...result, ...readGlb(result.glb) };
}

/** World positions of every node (nodes carry translation only). */
function worldPositions(json) {
  const parent = new Map();
  json.nodes.forEach((node, i) => (node.children ?? []).forEach((c) => parent.set(c, i)));
  return json.nodes.map((_, i) => {
    const p = [0, 0, 0];
    for (let n = i; n !== undefined; n = parent.get(n)) {
      const t = json.nodes[n].translation ?? [0, 0, 0];
      for (let k = 0; k < 3; k++) p[k] += t[k];
    }
    return p;
  });
}

const node = (json, bone) => json.extensions.VRMC_vrm.humanoid.humanBones[bone]?.node;

test("writes a VRM 1.0 file with the conversion marker", async () => {
  const { json } = await convert();
  assert.equal(json.asset.version, "2.0");
  assert.equal(json.extensions.VRMC_vrm.specVersion, "1.0");
  for (const name of ["VRMC_vrm", "VRMC_materials_mtoon", MARKER_EXTENSION]) assert.ok(json.extensionsUsed.includes(name), name);
  assert.deepEqual(json.extensions[MARKER_EXTENSION], { source: "pmx", converter: "9.9.9" });
  assert.equal(json.extensionsRequired, undefined);
});

test("maps the humanoid to the D-bones, which carry the skin", async () => {
  const { json } = await convert();
  assert.equal(node(json, "leftUpperLeg"), BONES.leftLegD);
  assert.equal(node(json, "leftLowerLeg"), BONES.leftKneeD);
  assert.equal(node(json, "leftFoot"), BONES.leftAnkleD);
  assert.equal(node(json, "rightUpperLeg"), BONES.rightLeg);
  assert.equal(node(json, "head"), BONES.head);
  assert.equal(node(json, "leftEye"), BONES.leftEye);
  assert.equal(node(json, "leftIndexProximal"), BONES.leftIndex1);
});

test("maps the plain leg chain when the model has no D-bones", async () => {
  const { json } = await convert(syntheticHumanoid({ dBones: false }));
  assert.equal(node(json, "leftUpperLeg"), BONES.leftLeg);
  assert.equal(node(json, "leftFoot"), BONES.leftAnkle);
});

test("uses the common ancestor of the spine and legs as hips, moved between them", async () => {
  const { json, report } = await convert();
  assert.equal(node(json, "hips"), BONES.center);
  const world = worldPositions(json);
  const hipsY = world[BONES.center][1];
  assert.ok(hipsY > world[BONES.leftLegD][1] && hipsY <= world[BONES.upperBody][1], `hips at ${hipsY}`);
  assert.ok(report.notes.some((n) => /hips pivot/.test(n)));
});

test("bakes a T-pose: arms along ±X, no node rotations, bind matrices at the nodes", async () => {
  const { json, bin } = await convert();
  assert.ok(json.nodes.every((n) => n.rotation === undefined && n.scale === undefined && n.matrix === undefined));
  const world = worldPositions(json);
  const dir = (a, b) => {
    const d = world[b].map((v, k) => v - world[a][k]);
    const l = Math.hypot(...d);
    return d.map((v) => v / l);
  };
  const left = dir(node(json, "leftUpperArm"), node(json, "leftLowerArm"));
  const right = dir(node(json, "rightUpperArm"), node(json, "rightLowerArm"));
  assert.ok(left[0] > 0.999, `left arm ${left}`);
  assert.ok(right[0] < -0.999, `right arm ${right}`);
  const skin = json.skins[0];
  const ibm = json.accessors[skin.inverseBindMatrices];
  const view = json.bufferViews[ibm.bufferView];
  const matrices = new Float32Array(bin.buffer.slice(bin.byteOffset + view.byteOffset, bin.byteOffset + view.byteOffset + view.byteLength));
  for (const joint of [BONES.head, node(json, "leftHand")]) {
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(matrices[joint * 16 + 12 + k] + world[joint][k]) < 1e-5);
  }
});

test("keeps the modelled pose with keepPose", async () => {
  const { json, report } = await convert(undefined, { keepPose: true });
  const world = worldPositions(json);
  const a = world[node(json, "leftUpperArm")];
  const b = world[node(json, "leftLowerArm")];
  assert.ok(b[1] < a[1] - 0.1, "the arm still points down");
  assert.ok(!report.notes.some((n) => /T-pose/.test(n)));
});

test("stands on y = 0, faces +Z, and scales 8 cm per MMD unit", async () => {
  const { json } = await convert();
  const position = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  assert.ok(Math.abs(position.min[1]) < 1e-6);
  const world = worldPositions(json);
  // MMD eyes sit at z = -0.8 (toward the viewer); mirrored, they face +Z.
  assert.ok(world[BONES.leftEye][2] > 0);
  assert.ok(Math.abs(world[BONES.head][1] - world[BONES.neck][1] - 0.08) < 1e-5);
});

test("keeps every vertex morph as a sparse, named morph target", async () => {
  const { json, report } = await convert();
  const mesh = json.meshes[0];
  assert.deepEqual(mesh.extras.targetNames, ["あ", "まばたき", "ウィンク２", "ｳｨﾝｸ２右"]);
  assert.equal(report.morphTargets, 4);
  for (const primitive of mesh.primitives) {
    assert.equal(primitive.targets.length, 4);
    const accessor = json.accessors[primitive.targets[0].POSITION];
    assert.equal(accessor.bufferView, undefined);
    assert.ok(accessor.sparse.count > 0 && accessor.sparse.count < accessor.count);
    assert.ok(accessor.min[1] < 0 && accessor.max[1] === 0);
  }
});

test("reverses MMD's clockwise winding", async () => {
  const parts = syntheticHumanoid();
  const { json, bin } = await convert(parts);
  const primitive = json.meshes[0].primitives[0];
  const indices = json.accessors[primitive.indices];
  const view = json.bufferViews[indices.bufferView];
  const values = new Uint16Array(bin.buffer.slice(bin.byteOffset + view.byteOffset, bin.byteOffset + view.byteOffset + 6));
  const [a, b, c] = parts.model.indices;
  assert.deepEqual(Array.from(values), [a, c, b]);
});

test("reads the author from the comment, and options override metadata", async () => {
  assert.equal(guessAuthor("◆模型制作：茶葉\r\n他"), "茶葉");
  assert.equal(guessAuthor("モデル製作：テスト作者"), "テスト作者");
  assert.equal(guessAuthor("Model: Someone"), "Someone");
  assert.equal(guessAuthor("配布：https://example.com"), null);
  assert.equal(guessAuthor("Model data is for MMD use only."), null);
  assert.equal(guessAuthor("Modeling software: Blender"), null);
  assert.equal(guessAuthor("改変：Editor\nモデル製作：Original"), "Original");
  assert.equal(guessAuthor("Author: A\nModel: Miku"), "A");
  const { json } = await convert();
  assert.deepEqual(json.extensions.VRMC_vrm.meta.authors, ["テスト作者"]);
  const meta = (await convert(undefined, { name: "N", author: "A", version: "2", copyright: "C" })).json.extensions.VRMC_vrm.meta;
  assert.deepEqual([meta.name, meta.authors[0], meta.version, meta.copyrightInformation], ["N", "A", "2", "C"]);
  assert.equal(meta.avatarPermission, "onlyAuthor");
  assert.equal(meta.allowRedistribution, false);
  assert.equal(meta.modification, "prohibited");
});

test("embeds textures found by case-insensitive paths and reports missing ones", async () => {
  const parts = syntheticHumanoid();
  const { json, report } = await convert(parts);
  assert.equal(json.images.length, 1);
  assert.equal(json.images[0].mimeType, "image/png");
  const missing = await convert({ ...parts, files: {} });
  assert.deepEqual(missing.report.missingTextures, [{ stored: "tex\\Body.bmp", problem: "not found" }]);
  assert.equal(missing.json.images, undefined);
  assert.equal(report.missingTextures.length, 0);
});

test("refuses a model without the bones VRM requires", async () => {
  const parts = syntheticHumanoid();
  parts.model.bones[BONES.head].name = "あたま";
  parts.model.bones[BONES.head].nameEn = "noggin";
  await assert.rejects(convert(parts), (error) => error instanceof ConversionError && error.report.missingRequired.includes("head"));
});

test("is deterministic", async () => {
  const parts = syntheticHumanoid();
  const a = await convert(parts);
  const b = await convert(parts);
  assert.ok(a.glb.equals(b.glb));
});

test("converts in memory without a folder, reporting the textures as missing", () => {
  const { model } = syntheticHumanoid();
  const { report } = convertPmx(writePmx(model), { baseDir: path.join(os.tmpdir(), "does-not-exist"), converterVersion: "0" });
  assert.equal(report.missingTextures.length, 1);
});

test("names the VRM after the file when the PMX has no name", async () => {
  const parts = syntheticHumanoid();
  parts.model.name = "";
  parts.model.nameEn = " ";
  assert.equal((await convert(parts, { fallbackName: "file-stem" })).json.extensions.VRMC_vrm.meta.name, "file-stem");
  assert.equal((await convert(parts)).json.extensions.VRMC_vrm.meta.name, "unknown");
});
