import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { convertPmx } from "./convert.mjs";
import { readGlb } from "./gltf.mjs";
import { MORPH_TYPES } from "./reader.mjs";
import { bindNames, meshAttributes, meshes, sparseEntries, targetOffsets } from "./testing/read-vrm.mjs";
import { BONES, syntheticHumanoid, writeModelFolder } from "./testing/synthetic.mjs";

async function convert(parts) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pmx-lookat-"));
  const file = await writeModelFolder(dir, parts);
  const result = convertPmx(new Uint8Array(await readFile(file)), { baseDir: dir, converterVersion: "test" });
  return { ...result, ...readGlb(result.glb), model: parts.model };
}

/** Parent node of each node. */
const parentsOf = (json) => {
  const parent = new Array(json.nodes.length).fill(-1);
  json.nodes.forEach((node, i) => (node.children ?? []).forEach((c) => (parent[c] = i)));
  return parent;
};

/**
 * Skin the listed PMX vertices with the eye node turned by `angle` about +Y
 * (the nodes carry only translations, so the eye's subtree turns about its
 * position and every other joint stays). Returns the skinned positions.
 */
function skinWithEyeTurned(json, bin, model, pmxVertices, eyeNode, angle) {
  // Each PMX vertex from the first mesh that holds it, at its index there.
  const data = meshes(json, model).map((m) => ({ ...m, ...meshAttributes(json, bin, m.mesh) }));
  const parent = parentsOf(json);
  const world = (node) => {
    const t = [0, 0, 0];
    for (let n = node; n >= 0; n = parent[n]) json.nodes[n].translation.forEach((v, k) => (t[k] += v));
    return t;
  };
  const pivot = world(eyeNode);
  const under = (node) => {
    for (let n = node; n >= 0; n = parent[n]) if (n === eyeNode) return true;
    return false;
  };
  const skinJoints = json.skins[0].joints;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return pmxVertices.map((pmx) => {
    const { positions, joints, weights, vertices } = /** @type {any} */ (data.find((m) => m.vertices.includes(pmx)));
    const v = vertices.indexOf(pmx);
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const d = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
    const turned = [pivot[0] + c * d[0] + s * d[2], p[1], pivot[2] - s * d[0] + c * d[2]];
    const out = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k];
      if (!(w > 0)) continue;
      const moved = under(skinJoints[joints[v * 4 + k]]) ? turned : p;
      for (let i = 0; i < 3; i++) out[i] += w * moved[i];
    }
    return out;
  });
}

const distances = (points) => points.flatMap((a, i) => points.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])));

test("eyes painted on the face get no look-at, and the report says why", async () => {
  const { json, report } = await convert(syntheticHumanoid());
  assert.equal(json.extensions.VRMC_vrm.lookAt, undefined);
  assert.match(report.lookAt, /^none: the eye bones carry no eye mesh, and no eye material .* painted on the face\.$/);
});

test("eye bones that carry the eyes give bone look-at between the eyes", async () => {
  const { json, report } = await convert(syntheticHumanoid({ eyes: "bone" }));
  const { lookAt } = json.extensions.VRMC_vrm;
  assert.equal(lookAt.type, "bone");
  const head = json.nodes[BONES.head];
  // The eyes sit at (±0.6, 18, −0.8) in MMD, the head at (0, 17, 0): mirrored and scaled.
  assert.deepEqual(lookAt.offsetFromHeadBone.map((v) => Math.round(v * 1e4) / 1e4), [0, 0.08, 0.064]);
  assert.deepEqual(lookAt.rangeMapHorizontalOuter, { inputMaxValue: 90, outputScale: 10 });
  assert.ok(head, "head node");
  assert.equal(report.lookAt, "bone ('左目', '右目').");
});

test("pupil and highlight bones beside the eyes move under the eye bones, so the eyes turn whole", async () => {
  const parts = syntheticHumanoid({ eyes: "pupil" });
  const { json, bin, model, report } = await convert(parts);
  assert.equal(json.extensions.VRMC_vrm.lookAt.type, "bone");
  const parent = parentsOf(json);
  for (const [p, eye] of [
    ["左", BONES.leftEye],
    ["右", BONES.rightEye],
  ]) {
    assert.equal(parent[json.nodes.findIndex((n) => n.name === `${p}瞳`)], eye, `${p}瞳`);
    assert.equal(parent[json.nodes.findIndex((n) => n.name === `${p}HL`)], eye, `${p}HL`);
    assert.equal(parent[json.nodes.findIndex((n) => n.name === `${p}眉`)], BONES.head, "the brow stays on the head");
    // The lashes follow the gaze only 0.3: they are the lid's, and the lid bone stays on the head.
    assert.equal(parent[json.nodes.findIndex((n) => n.name === `${p}まぶた`)], BONES.head, "the lid stays on the head");
    // Turning the eye bone moves the iris and highlight rigidly, and leaves the white.
    const moving = [...parts.eyeParts[`${p}iris`], ...parts.eyeParts[`${p}highlight`]];
    const before = skinWithEyeTurned(json, bin, model, moving, eye, 0);
    const after = skinWithEyeTurned(json, bin, model, moving, eye, 0.3);
    const [d0, d1] = [distances(before), distances(after)];
    assert.ok(d0.every((d, i) => Math.abs(d - d1[i]) < 1e-5), "rigid");
    assert.ok(Math.hypot(...before[0].map((v, k) => v - after[0][k])) > 1e-3, "and it does move");
    const white = parts.eyeParts[`${p}white`];
    assert.deepEqual(skinWithEyeTurned(json, bin, model, white, eye, 0.3), skinWithEyeTurned(json, bin, model, white, eye, 0));
  }
  // Nodes keep their rest positions: the moved bones' world positions are unchanged.
  const world = (node) => {
    const t = [0, 0, 0];
    for (let n = node; n >= 0; n = parent[n]) json.nodes[n].translation.forEach((v, k) => (t[k] += v));
    return t;
  };
  const pupil = world(json.nodes.findIndex((n) => n.name === "左瞳"));
  assert.ok(Math.abs(pupil[0] - 0.6 * 0.08) < 1e-6 && Math.abs(pupil[2] - 1.46 * 0.08) < 1e-6, `${pupil}`);
  assert.match(report.lookAt, /^bone \('左目', '右目'\), with 4 bones beside the eyes moved under them \('左瞳', '左HL', '右瞳', '右HL'\)\.$/);
});

test("when a bone that also moves the cheek carries part of an eye, look-at turns the eyes by expression", async () => {
  const parts = syntheticHumanoid({ eyes: "stuck" });
  const { json, bin, model, report } = await convert(parts);
  const vrm = json.extensions.VRMC_vrm;
  assert.equal(vrm.lookAt.type, "expression");
  assert.deepEqual(vrm.lookAt.rangeMapVerticalUp, { inputMaxValue: 90, outputScale: 1 });
  assert.equal(report.lookAt, "expression (lookUp/Down/Left/Right morph targets turn the eye meshes, because 2 bones that carry part of the eyes cannot move under the eye bones; '左頬', for one, also moves other parts of the model).");
  for (const preset of ["lookLeft", "lookRight", "lookUp", "lookDown"]) assert.deepEqual(bindNames(json, vrm.expressions.preset[preset]), [[preset, 1]]);
  // No bone moved: the cheek bones stay on the head.
  assert.equal(parentsOf(json)[json.nodes.findIndex((n) => n.name === "左頬")], BONES.head);
  // lookLeft turns the left iris's front (toward +Z, the face's front) toward +X, the model's left.
  const offsets = targetOffsets(json, bin, model, "lookLeft");
  assert.equal(offsets.size, parts.eyeParts["左iris"].length + parts.eyeParts["右iris"].length);
  const front = parts.eyeParts["左iris"].slice(0, 4); // the box's first end is the iris front
  for (const v of front) assert.ok(offsets.get(v)?.[0] > 0, `vertex ${v} moves toward +X`);
  // The look targets are only in the eye material's mesh.
  assert.deepEqual(json.meshes.filter((mesh) => mesh.extras?.targetNames?.includes("lookLeft")).map((mesh) => mesh.name), ["目"]);
  // The blinks block the look while the eyes are closed, so the iris does not cross the lid.
  assert.equal(vrm.expressions.preset.blink.overrideLookAt, "block");
});

test("an eye material on the head turns by expression about a point behind each eye", async () => {
  const { json, report } = await convert(syntheticHumanoid({ eyes: "material" }));
  const { lookAt } = json.extensions.VRMC_vrm;
  assert.equal(lookAt.type, "expression");
  assert.match(report.lookAt, /because the eye bones carry no eye mesh\)\.$/);
  // Between the eyes, behind the eye fronts by one eye width.
  assert.equal(Math.round(lookAt.offsetFromHeadBone[0] * 1e4), 0);
  assert.ok(lookAt.offsetFromHeadBone[2] < 1.5 * 0.08 && lookAt.offsetFromHeadBone[2] > 0.5 * 0.08, `${lookAt.offsetFromHeadBone}`);
});

test("a vertex both eyes carry turns with the nearer eye only", async () => {
  const parts = syntheticHumanoid({ eyes: "bone" });
  const { model, eyeParts } = parts;
  // Half on each eye: both eyes' parts hold it, and look-at falls back to expression.
  const v = eyeParts["左iris"][0];
  model.weightTypes[v] = 1;
  model.skinBones.set([BONES.leftEye, BONES.rightEye, -1, -1], v * 4);
  model.skinWeights.set([0.5, 0.5, 0, 0], v * 4);
  const { json, bin } = await convert(parts);
  assert.equal(json.extensions.VRMC_vrm.lookAt.type, "expression");
  const eyeMesh = json.meshes.findIndex((mesh) => mesh.name === "目");
  const target = json.meshes[eyeMesh].primitives[0].targets[json.meshes[eyeMesh].extras.targetNames.indexOf("lookLeft")];
  const { indices } = sparseEntries(json, bin, target.POSITION);
  assert.equal(indices.length, eyeParts["左iris"].length + eyeParts["右iris"].length, "each vertex once");
  assert.ok(indices.every((index, i) => i === 0 || index > indices[i - 1]), "strictly increasing");
});

test("a bone beside the eye that hangs from another bone a morph moves is not cut off it", async () => {
  const parts = syntheticHumanoid({ eyes: "pupil" });
  const { bones, morphs } = parts.model;
  // Both highlights hang from one bone, which a bone morph moves to hide them.
  const holder = bones.push({ ...bones[BONES.head], name: "ハイライト親", nameEn: "", parent: BONES.head, position: [0, 18.1, -1.5] }) - 1;
  for (const name of ["左HL", "右HL"]) bones.find((b) => b.name === name).parent = holder;
  morphs.push({ name: "ハイライト消", nameEn: "", panel: 4, type: MORPH_TYPES.bone, group: [], vertex: [], uv: [], material: [], impulseCount: 0, bone: [{ bone: holder, translation: [0, 0, 1], rotation: [0, 0, 0, 1] }] });
  const { json, report } = await convert(parts);
  assert.equal(json.extensions.VRMC_vrm.lookAt.type, "expression");
  assert.match(report.lookAt, /2 bones that carry part of the eyes .* hangs from 'ハイライト親', which is not above the eye bone\)\.$/);
  assert.ok(json.meshes.some((mesh) => mesh.extras?.targetNames?.includes("ハイライト消")), "the morph still moves the highlights");
});

test("a bone that carries part of both eyes is counted once among the stuck bones", async () => {
  const parts = syntheticHumanoid({ eyes: "pupil" });
  const { bones } = parts.model;
  // One highlight bone for both eyes, hanging from a bone other than the head.
  const holder = bones.push({ ...bones[BONES.head], name: "目親", nameEn: "", parent: BONES.head }) - 1;
  const left = bones.findIndex((b) => b.name === "左HL");
  const right = bones.findIndex((b) => b.name === "右HL");
  bones[left].parent = holder;
  const { skinBones } = parts.model;
  for (let i = 0; i < skinBones.length; i++) if (skinBones[i] === right) skinBones[i] = left;
  const { report } = await convert(parts);
  assert.match(report.lookAt, /because '左HL' carries part of an eye but hangs from '目親'/);
});

test("a pupil bone at the eyeball's centre still moves under the eye bone", async () => {
  const parts = syntheticHumanoid({ eyes: "pupil" });
  const { bones } = parts.model;
  for (const [name, eye] of [
    ["左瞳", BONES.leftEye],
    ["右瞳", BONES.rightEye],
  ])
    bones.find((b) => b.name === name).position = [...bones[eye].position];
  const { json } = await convert(parts);
  assert.equal(json.extensions.VRMC_vrm.lookAt.type, "bone");
  assert.equal(parentsOf(json)[json.nodes.findIndex((n) => n.name === "左瞳")], BONES.leftEye);
});

test("eye materials are found by their Japanese, Chinese or English name", async () => {
  for (const [name, nameEn] of [
    ["黒目", ""],
    ["眼睛", ""],
    ["目の色", "Iris"],
    ["eye_L", ""],
  ]) {
    const parts = syntheticHumanoid({ eyes: "material" });
    Object.assign(parts.model.materials.at(-1), { name, nameEn });
    const { json } = await convert(parts);
    assert.equal(json.extensions.VRMC_vrm.lookAt?.type, "expression", `${name} ${nameEn}`);
  }
});

test("an eyeball turns about its centre", async () => {
  const { json } = await convert(syntheticHumanoid({ eyes: "eyeball" }));
  const { lookAt } = json.extensions.VRMC_vrm;
  assert.equal(lookAt.type, "expression");
  // The balls run from z = −1.0 to −1.6 in MMD: their centre is 1.3 in front of the head.
  assert.ok(Math.abs(lookAt.offsetFromHeadBone[2] - 1.3 * 0.08) < 1e-4, `${lookAt.offsetFromHeadBone}`);
});
