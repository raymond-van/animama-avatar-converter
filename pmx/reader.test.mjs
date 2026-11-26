import assert from "node:assert/strict";
import { test } from "node:test";
import { PmxFormatError, readPmx } from "./reader.mjs";
import { syntheticHumanoid } from "./testing/synthetic.mjs";
import { writePmx } from "./testing/writer.mjs";

function assertSameModel(read, original) {
  assert.equal(read.name, original.name);
  assert.equal(read.nameEn, original.nameEn);
  assert.equal(read.comment, original.comment);
  assert.equal(read.vertexCount, original.vertexCount);
  assert.deepEqual(Array.from(read.positions), Array.from(original.positions));
  assert.deepEqual(Array.from(read.indices), Array.from(original.indices));
  assert.deepEqual(read.textures, original.textures);
  assert.deepEqual(
    read.materials.map((m) => [m.name, m.indexCount, m.sharedToon, m.toonIndex, m.textureIndex, m.flags]),
    original.materials.map((m) => [m.name, m.indexCount, m.sharedToon, m.toonIndex, m.textureIndex, m.flags]),
  );
  assert.deepEqual(
    read.bones.map((b) => [b.name, b.parent, b.flags, b.inheritParent, b.ik?.links.length ?? 0]),
    original.bones.map((b) => [b.name, b.parent, b.flags, b.inheritParent, b.ik?.links.length ?? 0]),
  );
  assert.deepEqual(
    read.morphs.map((m) => [m.name, m.type, m.panel, m.vertex.length, m.group.length, m.bone.length, m.uv.length, m.material.length]),
    original.morphs.map((m) => [m.name, m.type, m.panel, m.vertex.length, m.group.length, m.bone.length, m.uv.length, m.material.length]),
  );
  assert.deepEqual(
    read.rigidBodies.map((b) => [b.name, b.bone, b.group, b.collisionMask, b.shape, b.mode]),
    original.rigidBodies.map((b) => [b.name, b.bone, b.group, b.collisionMask, b.shape, b.mode]),
  );
  assert.equal(read.joints.length, original.joints.length);
}

test("reads back a UTF-16 model with two-byte indices", () => {
  const { model } = syntheticHumanoid();
  assertSameModel(readPmx(writePmx(model, { encoding: 0, indexSize: 2 })), model);
});

test("reads back a UTF-8 PMX 2.1 model with four-byte indices and additional UVs", () => {
  const { model } = syntheticHumanoid();
  const read = readPmx(writePmx({ ...model, version: 2.1, softBodyCount: 3 }, { encoding: 1, indexSize: 4, vertexSize: 4, additionalUvs: 2 }));
  assertSameModel(read, model);
  assert.equal(read.version, 2.1);
  assert.equal(read.encoding, 1);
  assert.equal(read.softBodyCount, 3);
});

test("reads one-byte indices, with -1 for none", () => {
  const { model } = syntheticHumanoid();
  const small = { ...model, bones: model.bones.slice(0, 1).map((b) => ({ ...b, parent: -1 })), rigidBodies: [], joints: [], morphs: [] };
  small.skinBones = small.skinBones.map((b) => (b < 0 ? -1 : 0));
  const read = readPmx(writePmx(small, { indexSize: 1, vertexSize: 2 }));
  assert.equal(read.bones[0].parent, -1);
  assert.equal(read.materials[1].textureIndex, -1);
});

test("keeps every weight type and SDEF as two bones", () => {
  const { model } = syntheticHumanoid();
  const read = readPmx(writePmx(model));
  assert.equal(read.weightTypes[0], 3);
  assert.deepEqual(Array.from(read.skinBones.subarray(0, 4)), [2, 3, -1, -1]);
  assert.ok(Math.abs(read.skinWeights[1] - 0.3) < 1e-6);
  assert.equal(read.weightTypes[1], 2);
});

test("rejects other files with a clear message", () => {
  assert.throws(() => readPmx(new Uint8Array([1, 2, 3, 4, 5])), PmxFormatError);
  assert.throws(() => readPmx(new Uint8Array(Buffer.from("Pmd\0\0\0\0\0"))), /PMD/);
  const bytes = writePmx(syntheticHumanoid().model);
  assert.throws(() => readPmx(bytes.subarray(0, bytes.length / 2)), /ends early/);
  const wrongVersion = new Uint8Array(bytes);
  new DataView(wrongVersion.buffer).setFloat32(4, 3, true);
  assert.throws(() => readPmx(wrongVersion), /version 3/);
});

test("rejects vertex indices out of range, negative ones included", () => {
  const { model } = syntheticHumanoid();
  const faces = { ...model, indices: Uint32Array.from([...model.indices.slice(0, -3), 0, 1, 0xffffffff]) };
  assert.throws(() => readPmx(writePmx(faces, { vertexSize: 4 })), /names vertex -1/);
  const morphs = model.morphs.map((m, i) => (i === 0 ? { ...m, vertex: [{ vertex: -1, offset: [0, 1, 0] }] } : m));
  assert.throws(() => readPmx(writePmx({ ...model, morphs }, { vertexSize: 4 })), /names vertex -1/);
});

test("reads NaN and infinite floats as 0", () => {
  const { model } = syntheticHumanoid();
  const positions = Float32Array.from(model.positions);
  positions[1] = NaN;
  positions[4] = Infinity;
  const read = readPmx(writePmx({ ...model, positions }));
  assert.equal(read.positions[1], 0);
  assert.equal(read.positions[4], 0);
});

test("refuses a declared count the file cannot hold", () => {
  const { model } = syntheticHumanoid();
  const bytes = writePmx(model);
  // The vertex count follows the header and four empty-ish texts; overwrite it with 50 million.
  const view = new DataView(bytes.buffer);
  const textsEnd = (() => {
    let o = 17;
    for (let i = 0; i < 4; i++) o += 4 + view.getInt32(o, true);
    return o;
  })();
  view.setInt32(textsEnd, 50_000_000, true);
  assert.throws(() => readPmx(bytes), /ends early/);
});
