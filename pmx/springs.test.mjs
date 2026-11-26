import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { convertPmx } from "./convert.mjs";
import { readGlb } from "./gltf.mjs";
import { BONES, syntheticHumanoid, writeModelFolder } from "./testing/synthetic.mjs";

async function convert(parts = syntheticHumanoid()) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pmx-springs-"));
  const file = await writeModelFolder(dir, parts);
  const result = convertPmx(new Uint8Array(await readFile(file)), { baseDir: dir, converterVersion: "test" });
  return { ...result, ...readGlb(result.glb) };
}

const springsOf = (json) => json.extensions.VRMC_springBone;
const nodeNamed = (json, name) => json.nodes.findIndex((node) => node.name === name);
const groupNames = (json, spring) => (spring.colliderGroups ?? []).map((g) => springsOf(json).colliderGroups[g].name);

test("a simulated hair chain becomes a spring that hits the head and body, not the legs", async () => {
  const { json, report } = await convert();
  assert.ok(json.extensionsUsed.includes("VRMC_springBone"));
  const { colliders, colliderGroups, springs } = springsOf(json);
  assert.equal(springs.length, 1);
  const [hair] = springs;
  assert.equal(hair.name, "髪1");
  // 髪3 has no body, so it is the chain's tail, not a joint that moves.
  assert.deepEqual(hair.joints.map((j) => j.node), [BONES.hair1, BONES.hair2, BONES.hair3]);
  assert.deepEqual(groupNames(json, hair), ["MMD group 1"]);
  // Head sphere and upper-body box (group 1), and the leg capsules (group 2).
  assert.deepEqual(colliderGroups.map((g) => [g.name, g.colliders.length]), [
    ["MMD group 1", 2],
    ["MMD group 2", 2],
  ]);
  const head = colliders.find((c) => c.node === BONES.head);
  assert.ok(Math.abs(head.shape.sphere.radius - 1.6 * 0.08) < 1e-4);
  const body = colliders.find((c) => c.node === BONES.upperBody);
  assert.ok(body.shape.capsule, "a box becomes a capsule along its longest axis");
  // The left leg's body sits on 左足D, the humanoid's leg; the D-bone is the collider's node.
  assert.ok(colliders.some((c) => c.node === BONES.leftLegD && c.shape.capsule));
  // pmx-to-vrm's formulas: 髪1's joint spans (1, 0.4, 0.6) rad with springs of 10.
  const [first] = hair.joints;
  assert.ok(Math.abs(first.stiffness - (0.6 / (2 / 3) + 10 / 40)) < 1e-3, `${first.stiffness}`);
  assert.ok(Math.abs(first.hitRadius - 0.3 * 0.08) < 1e-4);
  assert.deepEqual(first.gravityDir, [0, -1, 0]);
  assert.match(report.springs[0], /^Springs: 1 chains with 3 joints \(1 under head\); 4 colliders in 2 groups\.$/);
});

test("a collider on a leg bone the humanoid does not use moves to the bone that does", async () => {
  const parts = syntheticHumanoid();
  parts.model.rigidBodies[1].bone = BONES.leftLeg; // 左足, while the humanoid uses 左足D
  const { json, report } = await convert(parts);
  const legs = springsOf(json).colliders.filter((c) => c.shape.capsule && c.node !== BONES.upperBody);
  assert.deepEqual(legs.map((c) => c.node).sort((a, b) => a - b), [BONES.rightLeg, BONES.leftLegD]);
  assert.ok(report.notes.some((note) => /moved onto the bones that move/.test(note)));
});

test("a skirt hits the legs, ends on new tail nodes, and its ring joint is reported", async () => {
  const { json, report } = await convert(syntheticHumanoid({ skirt: true }));
  const { springs } = springsOf(json);
  const front = springs.find((s) => s.name === "スカート前1");
  const back = springs.find((s) => s.name === "スカート後1");
  assert.ok(front && back);
  for (const spring of [front, back]) assert.deepEqual(groupNames(json, spring), ["MMD group 2"], "the legs only");
  const tail = front.joints.at(-1).node;
  assert.equal(json.nodes[tail].name, "スカート前2_end");
  assert.ok(json.nodes[nodeNamed(json, "スカート前2")].children.includes(tail));
  assert.ok(json.nodes[tail].translation[1] < 0, "the tail hangs below its bone");
  assert.equal(report.dropped["physics joints between neighbouring chains (VRM springs only hang)"], 1);
  // The mesh nodes follow the bones and the tail nodes, and the scene holds each.
  const meshNodes = json.nodes.flatMap((node, i) => (node.mesh !== undefined ? [i] : []));
  assert.equal(meshNodes.length, json.meshes.length);
  assert.ok(meshNodes.every((i) => i > tail));
  for (const i of meshNodes) assert.ok(json.scenes[0].nodes.includes(i));
});

test("a branch starts its own spring; the deepest child continues the chain", async () => {
  const { json } = await convert(syntheticHumanoid({ branch: true }));
  const { springs } = springsOf(json);
  assert.deepEqual(
    springs.map((s) => [s.name, s.joints.map((j) => json.nodes[j.node].name)]),
    [
      ["髪1", ["髪1", "髪2", "髪3", "髪3_end"]],
      ["髪3b", ["髪3b", "髪3b_end"]],
    ],
  );
  // 髪3's tail follows its PMX tail offset (0, −2, 0.2), mirrored and scaled.
  const tail = json.nodes[nodeNamed(json, "髪3_end")].translation;
  assert.ok(Math.abs(tail[1] + 2 * 0.08) < 1e-5 && Math.abs(tail[2] + 0.2 * 0.08) < 1e-5, `${tail}`);
});

test("warns about joints that start inside a collider they hit", async () => {
  const parts = syntheticHumanoid();
  // Grow the head sphere past 髪2.
  parts.model.rigidBodies[0].size = [4, 0, 0];
  const { report } = await convert(parts);
  assert.ok(report.warnings.some((w) => /start inside a collider .*髪1 \(\d\)/.test(w)), report.warnings.join("\n"));
});

test("a model without physics writes no springs", async () => {
  const parts = syntheticHumanoid();
  parts.model.rigidBodies = [];
  parts.model.joints = [];
  const { json, report } = await convert(parts);
  assert.equal(json.extensions.VRMC_springBone, undefined);
  assert.ok(!json.extensionsUsed.includes("VRMC_springBone"));
  assert.equal(report.springs, undefined);
});

test("the lower body's body is a collider for the skirt, though the skirt hangs from it", async () => {
  const parts = syntheticHumanoid({ skirt: true });
  // MMD's usual hip body, on 下半身, in the legs' group.
  parts.model.rigidBodies.push({ ...parts.model.rigidBodies[1], name: "下半身", bone: BONES.lowerBody, shape: 0, size: [1.2, 0, 0], position: [0, 10, 0] });
  const { json, report } = await convert(parts);
  const { colliders, springs } = springsOf(json);
  const hip = colliders.findIndex((c) => c.node === BONES.lowerBody);
  assert.ok(hip >= 0, "a collider on 下半身");
  const skirt = springs.find((s) => s.name === "スカート前1");
  assert.ok(skirt.colliderGroups.some((g) => springsOf(json).colliderGroups[g].colliders.includes(hip)));
  assert.ok(!report.notes.some((note) => /hold a chain's root/.test(note)));
});

test("physics on a humanoid bone is left off: the bone follows the animation and its body is a collider", async () => {
  const parts = syntheticHumanoid();
  parts.model.rigidBodies.push({ ...parts.model.rigidBodies[0], name: "首", bone: BONES.neck, mode: 2, size: [0.5, 0, 0], position: [0, 16.3, 0] });
  const { json, report } = await convert(parts);
  assert.equal(json.extensions.VRMC_vrm.humanoid.humanBones.neck.node, BONES.neck);
  assert.ok(report.warnings.some((w) => /Physics on humanoid bones was left off.*'首'/.test(w)), report.warnings.join("\n"));
  const { colliders, springs } = springsOf(json);
  assert.ok(colliders.some((c) => c.node === BONES.head), "the head still has its collider");
  assert.ok(colliders.some((c) => c.node === BONES.neck));
  assert.deepEqual(springs.map((s) => s.name), ["髪1"]);
});

test("a joint across a bone without physics, along one strand, is not counted as between chains", async () => {
  const parts = syntheticHumanoid();
  const { rigidBodies, joints } = parts.model;
  rigidBodies[4].mode = 0; // 髪2 follows its bone
  const tip = rigidBodies.push({ ...rigidBodies[3], name: "髪3", bone: BONES.hair3, position: [0, 13, 1.8] }) - 1;
  joints.push({ ...joints[0], name: "髪1-3", bodyA: 3, bodyB: tip });
  const { json, report } = await convert(parts);
  assert.deepEqual(springsOf(json).springs.map((s) => s.name), ["髪1", "髪3"]);
  assert.equal(report.dropped["physics joints between neighbouring chains (VRM springs only hang)"], undefined);
});
