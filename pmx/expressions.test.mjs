import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { convertPmx } from "./convert.mjs";
import { readGlb } from "./gltf.mjs";
import { isDescendant } from "./humanoid.mjs";
import { BONE_FLAGS, MORPH_TYPES } from "./reader.mjs";
import { BONES, syntheticHumanoid, writeModelFolder } from "./testing/synthetic.mjs";

async function convert(parts = syntheticHumanoid(), options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pmx-expressions-"));
  const file = await writeModelFolder(dir, parts);
  const result = convertPmx(new Uint8Array(await readFile(file)), { baseDir: dir, converterVersion: "test", ...options });
  return { ...result, ...readGlb(result.glb) };
}

/** A sparse morph target's offsets by vertex. */
function targetOffsets(json, bin, index) {
  const accessor = json.accessors[json.meshes[0].primitives[0].targets[index].POSITION];
  const view = (v) => json.bufferViews[v];
  const indicesView = view(accessor.sparse.indices.bufferView);
  const valuesView = view(accessor.sparse.values.bufferView);
  const Indices = accessor.sparse.indices.componentType === 5123 ? Uint16Array : Uint32Array;
  const indices = new Indices(bin.buffer.slice(bin.byteOffset + indicesView.byteOffset, bin.byteOffset + indicesView.byteOffset + indicesView.byteLength));
  const values = new Float32Array(bin.buffer.slice(bin.byteOffset + valuesView.byteOffset, bin.byteOffset + valuesView.byteOffset + valuesView.byteLength));
  return new Map(Array.from(indices, (v, i) => [v, [values[i * 3], values[i * 3 + 1], values[i * 3 + 2]]]));
}

const expressionsOf = (json) => json.extensions.VRMC_vrm.expressions;
const targetIndex = (json, name) => json.meshes[0].extras.targetNames.indexOf(name);

test("fills the presets, with winks judged by side and emotions blending the blink", async () => {
  const { json, report } = await convert();
  const { preset } = expressionsOf(json);
  assert.deepEqual(preset.aa.morphTargetBinds, [{ node: json.nodes.length - 1, index: targetIndex(json, "あ"), weight: 1 }]);
  assert.equal(preset.blink.morphTargetBinds[0].index, targetIndex(json, "まばたき"));
  assert.equal(preset.blinkLeft.morphTargetBinds[0].index, targetIndex(json, "ウィンク２"));
  assert.equal(preset.blinkRight.morphTargetBinds[0].index, targetIndex(json, "ｳｨﾝｸ２右"));
  // 笑い is a group morph (eye panel); its baked target plays the happy eyes, so happy blends the blink.
  assert.deepEqual(preset.happy.morphTargetBinds.map((b) => b.index), [targetIndex(json, "笑い")]);
  assert.equal(preset.happy.overrideBlink, "blend");
  assert.equal(preset.aa.overrideBlink, "none");
  assert.ok(report.expressions.some((line) => line.name === "happy" && /eyes 笑い/.test(line.binds[0])));
});

test("writes Animama's per-region parts and a custom expression for every converted morph", async () => {
  const { json } = await convert();
  const { custom } = expressionsOf(json);
  assert.deepEqual(custom.Fcl_EYE_Joy.morphTargetBinds.map((b) => b.index), [targetIndex(json, "笑い")]);
  assert.deepEqual(custom.Fcl_BRW_Angry.morphTargetBinds.map((b) => b.index), [targetIndex(json, "怒り")]);
  assert.ok(custom.Fcl_ALL_Joy);
  for (const name of ["首かしげ", "照れ"]) assert.ok(custom[name], name);
  // Every converted morph is listed under its own name, even one a preset already plays.
  assert.deepEqual(custom["あ"].morphTargetBinds.map((b) => b.index), [targetIndex(json, "あ")]);
  assert.equal(custom.Fcl_BRW_Joy, undefined, "no brow morph smiles: that region stays neutral");
});

test("bakes a group morph's weighted parts into one target", async () => {
  const { json, bin } = await convert();
  const group = targetOffsets(json, bin, targetIndex(json, "笑い"));
  const blink = targetOffsets(json, bin, targetIndex(json, "まばたき"));
  const mouth = targetOffsets(json, bin, targetIndex(json, "あ"));
  // 笑い = まばたき × 0.5 + あ × 0.3 (+ a material part, which is no geometry).
  const every = new Set([...group.keys(), ...blink.keys(), ...mouth.keys()]);
  assert.ok(every.size > 0);
  for (const v of every) {
    const expected = [0, 1, 2].map((k) => (blink.get(v)?.[k] ?? 0) * 0.5 + (mouth.get(v)?.[k] ?? 0) * 0.3);
    const offset = group.get(v) ?? [0, 0, 0];
    assert.ok(offset.every((value, k) => Math.abs(value - expected[k]) < 1e-6), `vertex ${v}`);
  }
});

test("bakes a bone morph by turning its bone about its pivot", async () => {
  const parts = syntheticHumanoid();
  const { json, bin } = await convert(parts);
  const offsets = targetOffsets(json, bin, targetIndex(json, "首かしげ"));
  const { positions } = parts.model;
  // 首かしげ turns the neck 0.2 rad about MMD's +Z. Mirrored into glTF (z → −z,
  // quaternion (−x, −y, z, w)) it is still +0.2 rad about +Z, so the head swings toward −X.
  const headVertex = parts.headVertices.find((v) => positions[v * 3 + 1] > 19);
  const offset = offsets.get(headVertex);
  assert.ok(offset, "the head moves");
  const neck = parts.model.bones[BONES.neck].position;
  const [dx, dy] = [(positions[headVertex * 3] - neck[0]) * 0.08, (positions[headVertex * 3 + 1] - neck[1]) * 0.08];
  const [c, s] = [Math.cos(0.2), Math.sin(0.2)];
  const expected = [c * dx - s * dy - dx, s * dx + c * dy - dy, 0];
  assert.ok(offset.every((value, k) => Math.abs(value - expected[k]) < 1e-5), `${offset} vs ${expected}`);
  assert.ok(offset[0] < 0, "toward −X");
  // Only vertices skinned to the neck or a bone under it (head, eyes, hair) move.
  const parent = parts.model.bones.map((bone) => bone.parent);
  const underNeck = (bone) => bone === BONES.neck || isDescendant(parent, bone, BONES.neck);
  for (const v of offsets.keys()) {
    const bones = Array.from(parts.model.skinBones.subarray(v * 4, v * 4 + 4)).filter((bone) => bone >= 0);
    assert.ok(bones.some(underNeck), `vertex ${v} is skinned to ${bones}`);
  }
});

test("turns material morphs into colour binds, and blends a material whose alpha a morph changes", async () => {
  const parts = syntheticHumanoid();
  parts.model.morphs[4].material[0].diffuse = [1, 0.8, 0.8, 0.5]; // 照れ also fades the body
  const { json } = await convert(parts);
  const binds = expressionsOf(json).custom["照れ"].materialColorBinds;
  const body = json.materials.findIndex((m) => m.name === "体");
  const color = binds.find((b) => b.material === body && b.type === "color");
  assert.ok(color, "a colour bind on the body");
  assert.equal(color.targetValue[3], 0.5);
  assert.ok(color.targetValue[1] < json.materials[body].pbrMetallicRoughness.baseColorFactor[1]);
  assert.equal(json.materials[body].alphaMode, "BLEND");
});

test("turns a UV morph that moves a whole material evenly into a texture offset", async () => {
  const parts = syntheticHumanoid();
  const { model } = parts;
  const hairStart = model.materials[0].indexCount;
  const hairVertices = [...new Set(model.indices.subarray(hairStart, hairStart + model.materials[1].indexCount))];
  model.morphs.push({ name: "髪色", nameEn: "", panel: 4, type: MORPH_TYPES.uv, group: [], vertex: [], bone: [], material: [], impulseCount: 0, uv: hairVertices.map((vertex) => ({ vertex, offset: [0.25, 0, 0, 0] })) });
  const { json, report } = await convert(parts);
  const hair = json.materials.findIndex((m) => m.name === "髪");
  assert.deepEqual(expressionsOf(json).custom["髪色"].textureTransformBinds, [{ material: hair, scale: [1, 1], offset: [0.25, 0] }]);
  assert.equal(report.dropped["UV morphs that do not move a whole material evenly"], 1, "UVスクロール moves one vertex");
});

test("applies --expression overrides, keeping each mood's preset and region parts in step", async () => {
  const { json, report } = await convert(undefined, {
    expressions: [
      { name: "happy", morphs: [{ morph: "あ", weight: 0.5 }, { morph: "まばたき", weight: 1 }] },
      { name: "Fcl_BRW_Angry", morphs: [] },
      { name: "blinkLeft", morphs: [{ morph: "ｳｨﾝｸ２右", weight: 1 }] },
    ],
  });
  const { preset, custom } = expressionsOf(json);
  const binds = (e) => (e.morphTargetBinds ?? []).map((b) => [json.meshes[0].extras.targetNames[b.index], b.weight]);
  // happy splits into its regions by each morph's panel: あ is mouth, まばたき eyes.
  assert.deepEqual(binds(preset.happy), [["あ", 0.5], ["まばたき", 1]]);
  assert.deepEqual(binds(custom.Fcl_ALL_Joy), binds(preset.happy));
  assert.deepEqual(binds(custom.Fcl_EYE_Joy), [["まばたき", 1]]);
  assert.deepEqual(binds(custom.Fcl_MTH_Joy), [["あ", 0.5]]);
  assert.deepEqual(binds(custom.Fcl_BRW_Joy), [], "an empty part, so the app keeps the brows still");
  assert.equal(preset.happy.overrideBlink, "blend");
  // A neutral region recomposes its mood without it.
  assert.deepEqual(binds(custom.Fcl_BRW_Angry), []);
  assert.deepEqual(binds(preset.angry), binds(custom.Fcl_ALL_Angry));
  assert.ok(!binds(preset.angry).some(([name]) => name === "怒り"));
  assert.deepEqual(binds(preset.blinkLeft), [["ｳｨﾝｸ２右", 1]]);
  assert.deepEqual(report.expressions.find((line) => line.name === "happy").binds, ["brows —, eyes まばたき, mouth あ×0.5"]);
});

test("refuses overrides it cannot apply", async () => {
  const run = (expressions) => convert(undefined, { expressions });
  await assert.rejects(run([{ name: "joy", morphs: [] }]), /not a preset or part/);
  await assert.rejects(run([{ name: "Fcl_ALL_Joy", morphs: [] }]), /not a preset or part/);
  await assert.rejects(run([{ name: "sad", morphs: [{ morph: "泣く", weight: 1 }] }]), /no face morph named "泣く"/);
  await assert.rejects(run([{ name: "happy", morphs: [] }, { name: "Fcl_EYE_Joy", morphs: [] }]), /both set the happy face/);
  const a = [{ morph: "あ", weight: 1 }];
  await assert.rejects(run([{ name: "aa", morphs: a }, { name: "aa", morphs: a }]), /given twice/);
  await assert.rejects(run([{ name: "blink", morphs: [] }]), /can't leave a blink or vowel empty/);
});

test("keeps every target name unique and the bone morph's neck bone untouched in the skeleton", async () => {
  const { json } = await convert();
  const names = json.meshes[0].extras.targetNames;
  assert.equal(new Set(names).size, names.length);
  assert.equal(json.nodes[BONES.neck].rotation, undefined);
});

/** A PMX morph record, as the reader returns one. */
const pmxMorph = (name, panel, type, parts) => ({ name, nameEn: "", panel, type, group: [], vertex: [], bone: [], uv: [], material: [], impulseCount: 0, ...parts });
/** A material-morph part that changes nothing (multiply by 1, or add 0), with changes on top. */
const materialPart = (material, operation, changes) => {
  const v = operation === 0 ? 1 : 0;
  return { material, operation, diffuse: [v, v, v, v], specular: [v, v, v], specularPower: v, ambient: [v, v, v], edgeColor: [v, v, v, v], edgeSize: v, textureTint: [v, v, v, v], sphereTint: [v, v, v, v], toonTint: [v, v, v, v], ...changes };
};

test("bakes bone morphs about any axis, mirrored, at weights other than 1", async () => {
  const parts = syntheticHumanoid();
  const { morphs } = parts.model;
  // A turn of 0.2 rad about MMD's +Y; mirrored into glTF it turns about +Y the other way.
  const turn = morphs.push(pmxMorph("首振り", 4, MORPH_TYPES.bone, { bone: [{ bone: BONES.neck, translation: [0, 0, 0], rotation: [0, Math.sin(0.1), 0, Math.cos(0.1)] }] })) - 1;
  morphs.push(pmxMorph("首振り半分", 4, MORPH_TYPES.group, { group: [{ morph: turn, weight: 0.5 }] }));
  morphs.push(pmxMorph("首振り二倍", 4, MORPH_TYPES.group, { group: [{ morph: turn, weight: 2 }] }));
  // And 0.2 rad about MMD's +X, which the mirror also reverses.
  morphs.push(pmxMorph("うなずき", 4, MORPH_TYPES.bone, { bone: [{ bone: BONES.neck, translation: [0, 0, 0], rotation: [Math.sin(0.1), 0, 0, Math.cos(0.1)] }] }));
  const { json, bin } = await convert(parts);
  const { positions } = parts.model;
  const neck = parts.model.bones[BONES.neck].position;
  const v = parts.headVertices[0];
  // glTF space: x as in MMD, z mirrored.
  const [dx, dz] = [(positions[v * 3] - neck[0]) * 0.08, -(positions[v * 3 + 2] - neck[2]) * 0.08];
  for (const [name, weight] of [
    ["首振り", 1],
    ["首振り半分", 0.5],
    ["首振り二倍", 2],
  ]) {
    const phi = -0.2 * weight;
    const expected = [Math.cos(phi) * dx + Math.sin(phi) * dz - dx, 0, -Math.sin(phi) * dx + Math.cos(phi) * dz - dz];
    const offset = targetOffsets(json, bin, targetIndex(json, name)).get(v);
    assert.ok(offset.every((value, k) => Math.abs(value - expected[k]) < 1e-5), `${name}: ${offset} vs ${expected}`);
  }
  const dy = (positions[v * 3 + 1] - neck[1]) * 0.08;
  const [c, s] = [Math.cos(-0.2), Math.sin(-0.2)];
  const expected = [0, c * dy - s * dz - dy, s * dy + c * dz - dz];
  const nod = targetOffsets(json, bin, targetIndex(json, "うなずき")).get(v);
  assert.ok(nod.every((value, k) => Math.abs(value - expected[k]) < 1e-5), `うなずき: ${nod} vs ${expected}`);
});

test("a bone that inherits another's rotation (付与) follows a bone morph on that bone", async () => {
  const parts = syntheticHumanoid();
  const { bones, morphs } = parts.model;
  // A driver beside the neck, as 両目 drives 左目 and 右目; the neck inherits all of its turn.
  const driver = bones.push({ ...bones[BONES.neck], name: "首親", nameEn: "", parent: BONES.upperBody2, flags: bones[BONES.neck].flags }) - 1;
  const inherits = BONE_FLAGS.inheritRotation | BONE_FLAGS.inheritTranslation;
  bones[BONES.neck] = { ...bones[BONES.neck], flags: bones[BONES.neck].flags | inherits, inheritParent: driver, inheritWeight: 0.5 };
  morphs.push(pmxMorph("首親かしげ", 4, MORPH_TYPES.bone, { bone: [{ bone: driver, translation: [0, 0, 0], rotation: [0, 0, Math.sin(0.1), Math.cos(0.1)] }] }));
  morphs.push(pmxMorph("首かしげ半分", 4, MORPH_TYPES.group, { group: [{ morph: 6, weight: 0.5 }] }));
  morphs.push(pmxMorph("首親上げ", 4, MORPH_TYPES.bone, { bone: [{ bone: driver, translation: [0, 1, 0], rotation: [0, 0, 0, 1] }] }));
  const { json, bin } = await convert(parts);
  // Half the driver's turn, as 首かしげ at half weight.
  const driven = targetOffsets(json, bin, targetIndex(json, "首親かしげ"));
  const direct = targetOffsets(json, bin, targetIndex(json, "首かしげ半分"));
  assert.ok(direct.size > 0);
  assert.deepEqual([...driven.keys()], [...direct.keys()]);
  for (const [v, offset] of direct) assert.ok(offset.every((value, k) => Math.abs(value - driven.get(v)[k]) < 1e-6), `vertex ${v}`);
  // Half the driver's move: the head rises 0.5 × 1 unit.
  const raised = targetOffsets(json, bin, targetIndex(json, "首親上げ"));
  assert.deepEqual([...raised.keys()], [...direct.keys()]);
  for (const offset of raised.values()) assert.ok(Math.abs(offset[1] - 0.04) < 1e-6 && Math.abs(offset[0]) < 1e-6 && Math.abs(offset[2]) < 1e-6, `${offset}`);
});

test("a morph named as the whole face plays the mood whole, blending the blink", async () => {
  const parts = syntheticHumanoid();
  const top = parts.headVertices.filter((v) => parts.model.positions[v * 3 + 1] > 19);
  parts.model.morphs.push(pmxMorph("Fcl_ALL_Joy", 2, MORPH_TYPES.vertex, { vertex: top.map((vertex) => ({ vertex, offset: [0, -0.1, 0] })) }));
  const { json } = await convert(parts);
  const { preset, custom } = expressionsOf(json);
  assert.deepEqual(preset.happy.morphTargetBinds.map((b) => b.index), [targetIndex(json, "Fcl_ALL_Joy")]);
  assert.equal(preset.happy.overrideBlink, "blend");
  assert.deepEqual(custom.Fcl_ALL_Joy.morphTargetBinds.map((b) => b.index), [targetIndex(json, "Fcl_ALL_Joy")]);
  assert.deepEqual(custom.Fcl_EYE_Joy.morphTargetBinds.map((b) => b.index), [targetIndex(json, "笑い")], "the eye panel's own morph still plays the eyes");
});

test("a morph that moves the whole face fills no single region", async () => {
  const parts = syntheticHumanoid();
  // Panel 4 (other) and a sad name, moving the eyes and the mouth fully.
  parts.model.morphs.push(pmxMorph("悲しみ", 4, MORPH_TYPES.group, { group: [{ morph: 1, weight: 1 }, { morph: 0, weight: 1 }] }));
  const { json } = await convert(parts);
  const { preset, custom } = expressionsOf(json);
  for (const region of ["BRW", "EYE", "MTH"]) assert.equal(custom[`Fcl_${region}_Sorrow`], undefined, region);
  assert.equal(preset.sad, undefined);
  assert.ok(custom["悲しみ"], "still listed under its own name");
});

test("texture and toon tints colour the whole material, as MMD multiplies them", async () => {
  const parts = syntheticHumanoid();
  parts.model.morphs.push(pmxMorph("墨", 4, MORPH_TYPES.material, { material: [materialPart(0, 0, { textureTint: [0, 0, 0, 1] })] }));
  parts.model.morphs.push(pmxMorph("赤", 4, MORPH_TYPES.material, { material: [materialPart(0, 0, { toonTint: [1, 0, 0, 1] })] }));
  const { json } = await convert(parts);
  const body = json.materials.findIndex((m) => m.name === "体");
  const bind = (name, type) => expressionsOf(json).custom[name].materialColorBinds.find((b) => b.material === body && b.type === type).targetValue;
  assert.deepEqual(bind("墨", "color").slice(0, 3), [0, 0, 0]);
  assert.deepEqual(bind("墨", "shadeColor").slice(0, 3), [0, 0, 0]);
  const red = bind("赤", "color");
  assert.ok(red[0] > 0.1 && red[1] === 0 && red[2] === 0, `${red}`);
});

test("a texture tint needs a texture; a brightening tint is reported", async () => {
  const parts = syntheticHumanoid();
  // The hair has no texture, so MMD leaves it as it is.
  parts.model.morphs.push(pmxMorph("髪赤", 4, MORPH_TYPES.material, { material: [materialPart(1, 0, { textureTint: [1, 0, 0, 1] })] }));
  parts.model.morphs.push(pmxMorph("明るく", 4, MORPH_TYPES.material, { material: [materialPart(0, 1, { textureTint: [0.3, 0.3, 0.3, 0] })] }));
  const { json, report } = await convert(parts);
  assert.equal(expressionsOf(json).custom["髪赤"], undefined);
  assert.equal(report.dropped["material morphs that brighten a texture or toon (VRM colours can only darken them)"], 1);
  assert.equal(report.dropped["morphs that change nothing VRM can show (no offsets, or bones and materials outside the model)"], 1, "only 髪赤, not the brightening one too");
});

test("a fade of every material leaves them opaque; a layer revealed from alpha 0 is cut out", async () => {
  const parts = syntheticHumanoid();
  const { morphs, materials } = parts.model;
  const fade = morphs.push(pmxMorph("全体透明", 4, MORPH_TYPES.material, { material: [materialPart(-1, 0, { diffuse: [1, 1, 1, 0.5] })] })) - 1;
  morphs.push(pmxMorph("全体透明2", 4, MORPH_TYPES.group, { group: [{ morph: fade, weight: 1 }] }));
  materials[1].diffuse = [0.2, 0.4, 0.9, 0]; // the hair, hidden at rest
  morphs.push(pmxMorph("髪表示", 4, MORPH_TYPES.material, { material: [materialPart(1, 1, { diffuse: [0, 0, 0, 1] })] }));
  const { json, report } = await convert(parts);
  const named = (name) => json.materials.find((m) => m.name === name);
  assert.equal(named("体").alphaMode ?? "OPAQUE", "OPAQUE");
  assert.equal(report.dropped["fades of every material at once (the model stays opaque)"], 1, "counted once, though a group uses it too");
  assert.equal(named("髪").alphaMode, "MASK");
  assert.equal(named("髪").alphaCutoff, 0.5);
  const reveal = expressionsOf(json).custom["髪表示"].materialColorBinds.find((b) => b.type === "color");
  assert.equal(reveal.targetValue[3], 1);
});

test("a layer a morph shows only partway stays blended, so the partial alpha shows", async () => {
  const parts = syntheticHumanoid();
  parts.model.materials[1].diffuse = [0.2, 0.4, 0.9, 0];
  parts.model.morphs.push(pmxMorph("髪うっすら", 4, MORPH_TYPES.material, { material: [materialPart(1, 1, { diffuse: [0, 0, 0, 0.4] })] }));
  const { json } = await convert(parts);
  const hair = json.materials.find((m) => m.name === "髪");
  assert.equal(hair.alphaMode, "BLEND");
  const bind = expressionsOf(json).custom["髪うっすら"].materialColorBinds.find((b) => b.type === "color");
  assert.ok(Math.abs(bind.targetValue[3] - 0.4) < 1e-6);
});

test("a second morph of the same name keeps its own expression; a morph that changes nothing is reported", async () => {
  const parts = syntheticHumanoid();
  parts.model.morphs.push(pmxMorph("あ", 3, MORPH_TYPES.vertex, { vertex: [{ vertex: parts.headVertices[0], offset: [0, 0.1, 0] }] }));
  parts.model.morphs.push(pmxMorph("無", 4, MORPH_TYPES.vertex, { vertex: [{ vertex: parts.headVertices[0], offset: [0, 0, 0] }] }));
  const { json, report } = await convert(parts);
  const { custom } = expressionsOf(json);
  assert.deepEqual(custom["あ_2"].morphTargetBinds.map((b) => b.index), [targetIndex(json, "あ_2")]);
  assert.equal(custom["無"], undefined);
  assert.equal(report.dropped["morphs that change nothing VRM can show (no offsets, or bones and materials outside the model)"], 1);
});
