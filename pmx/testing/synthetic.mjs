import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BONE_FLAGS, MATERIAL_FLAGS, MORPH_TYPES } from "../reader.mjs";
import { writePmx } from "./writer.mjs";

/**
 * Synthetic MMD-style models for tests, built in code so no third-party model
 * ever enters the repository. Adapted from pmx-to-vrm's test
 * `SyntheticModel` (MIT).
 */

/** @typedef {import("../reader.mjs").PmxModel} PmxModel */
/** @typedef {[number, number, number]} Vec3 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scalev = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(...a);
const norm = (a) => scalev(a, 1 / (len(a) || 1));
const crossv = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Builds a PmxModel piece by piece. */
export class ModelBuilder {
  constructor({ name = "テストモデル", nameEn = "Test Model", comment = "", commentEn = "" } = {}) {
    this.header = { name, nameEn, comment, commentEn };
    /** @type {{position: Vec3, normal: Vec3, uv: [number, number], type: number, bones: number[], weights: number[]}[]} */
    this.vertices = [];
    /** @type {number[][]} Indices per material, in material order. */
    this.faceLists = [];
    /** @type {import("../reader.mjs").PmxMaterial[]} */
    this.materials = [];
    /** @type {string[]} */
    this.textures = [];
    /** @type {import("../reader.mjs").PmxBone[]} */
    this.bones = [];
    /** @type {import("../reader.mjs").PmxMorph[]} */
    this.morphs = [];
    /** @type {import("../reader.mjs").PmxRigidBody[]} */
    this.rigidBodies = [];
    /** @type {import("../reader.mjs").PmxJoint[]} */
    this.joints = [];
  }

  /** @returns {number} */
  bone(name, position, parent, extra = {}) {
    this.bones.push({
      name,
      nameEn: extra.nameEn ?? "",
      position,
      parent,
      layer: 0,
      flags: BONE_FLAGS.rotatable | BONE_FLAGS.visible | BONE_FLAGS.enabled | (extra.flags ?? 0),
      tailBone: extra.tailBone ?? -1,
      tailOffset: extra.tailOffset ?? [0, 0, 0],
      inheritParent: extra.inheritParent ?? -1,
      inheritWeight: extra.inheritWeight ?? 0,
      ik: extra.ik ?? null,
    });
    return this.bones.length - 1;
  }

  /** @returns {number} */
  texture(stored) {
    this.textures.push(stored);
    return this.textures.length - 1;
  }

  /**
   * Start a material; following boxes draw with it.
   * @param {Partial<import("../reader.mjs").PmxMaterial>} props
   */
  material(props) {
    this.materials.push({
      name: "material",
      nameEn: "",
      diffuse: [1, 1, 1, 1],
      specular: [0, 0, 0],
      specularPower: 5,
      ambient: [0.5, 0.5, 0.5],
      flags: 0,
      edgeColor: [0, 0, 0, 1],
      edgeSize: 1,
      textureIndex: -1,
      sphereIndex: -1,
      sphereMode: 0,
      sharedToon: true,
      toonIndex: 0,
      memo: "",
      indexCount: 0,
      ...props,
    });
    this.faceLists.push([]);
    return this.materials.length - 1;
  }

  /**
   * A thin box from a to b, skinned to `bone` (the far end half to `bone2`
   * when given), drawn with the current material in MMD's clockwise winding.
   * @returns {number[]} The box's vertex indices.
   */
  box(a, b, half, bone, bone2 = -1) {
    const axis = sub(b, a);
    const d = len(axis) > 1e-5 ? norm(axis) : [0, 1, 0];
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = scalev(norm(crossv(d, up)), half);
    const v = scalev(norm(crossv(d, u)), half);
    const start = this.vertices.length;
    for (let e = 0; e < 2; e++) {
      const p0 = e === 0 ? a : b;
      const corners = [addv(addv(p0, u), v), addv(sub(p0, u), v), sub(sub(p0, u), v), sub(addv(p0, u), v)];
      corners.forEach((corner, k) => {
        const twoBones = bone2 >= 0 && e === 1;
        this.vertices.push({
          position: corner,
          normal: norm(addv(sub(corner, p0), scalev(d, 0.001))),
          uv: [k / 3, e],
          type: twoBones ? 1 : 0,
          bones: twoBones ? [bone, bone2, -1, -1] : [bone, -1, -1, -1],
          weights: twoBones ? [0.5, 0.5, 0, 0] : [1, 0, 0, 0],
        });
      });
    }
    const faces = this.faceLists[this.faceLists.length - 1];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      const [a0, a1, b0, b1] = [start + k, start + k2, start + 4 + k, start + 4 + k2];
      faces.push(a0, b0, a1, a1, b0, b1);
    }
    faces.push(start, start + 1, start + 2, start, start + 2, start + 3);
    faces.push(start + 4, start + 6, start + 5, start + 4, start + 7, start + 6);
    return Array.from({ length: 8 }, (_, i) => start + i);
  }

  /** A vertex morph moving the listed vertices by one offset. @returns {number} */
  vertexMorph(name, panel, vertices, offset, nameEn = "") {
    this.morphs.push(emptyMorph(name, nameEn, panel, MORPH_TYPES.vertex));
    this.morphs.at(-1).vertex = vertices.map((vertex) => ({ vertex, offset }));
    return this.morphs.length - 1;
  }

  /** @returns {number} */
  morph(name, panel, type, parts = {}, nameEn = "") {
    this.morphs.push({ ...emptyMorph(name, nameEn, panel, type), ...parts });
    return this.morphs.length - 1;
  }

  /** @returns {number} */
  body(props) {
    this.rigidBodies.push({
      name: "body",
      nameEn: "",
      bone: -1,
      group: 0,
      collisionMask: 0xffff,
      shape: 0,
      size: [1, 0, 0],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      mass: 1,
      linearDamping: 0.5,
      angularDamping: 0.5,
      restitution: 0,
      friction: 0.5,
      mode: 0,
      ...props,
    });
    return this.rigidBodies.length - 1;
  }

  joint(props) {
    this.joints.push({
      name: "joint",
      type: 0,
      bodyA: -1,
      bodyB: -1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      positionMin: [0, 0, 0],
      positionMax: [0, 0, 0],
      rotationMin: [0, 0, 0],
      rotationMax: [0, 0, 0],
      positionSpring: [0, 0, 0],
      rotationSpring: [0, 0, 0],
      ...props,
    });
  }

  /** @returns {PmxModel} */
  build({ version = 2, encoding = 0 } = {}) {
    const n = this.vertices.length;
    const model = {
      version,
      encoding,
      additionalUvCount: 0,
      ...this.header,
      vertexCount: n,
      positions: new Float32Array(n * 3),
      normals: new Float32Array(n * 3),
      uvs: new Float32Array(n * 2),
      weightTypes: new Uint8Array(n),
      skinBones: new Int32Array(n * 4).fill(-1),
      skinWeights: new Float32Array(n * 4),
      edgeScales: new Float32Array(n).fill(1),
      indices: Uint32Array.from(this.faceLists.flat()),
      textures: [...this.textures],
      materials: this.materials.map((m, i) => ({ ...m, indexCount: this.faceLists[i].length })),
      bones: this.bones,
      morphs: this.morphs,
      rigidBodies: this.rigidBodies,
      joints: this.joints,
      softBodyCount: 0,
    };
    this.vertices.forEach((v, i) => {
      model.positions.set(v.position, i * 3);
      model.normals.set(v.normal, i * 3);
      model.uvs.set(v.uv, i * 2);
      model.weightTypes[i] = v.type;
      model.skinBones.set(v.bones, i * 4);
      model.skinWeights.set(v.weights, i * 4);
    });
    return /** @type {PmxModel} */ (model);
  }
}

function emptyMorph(name, nameEn, panel, type) {
  return { name, nameEn, panel, type, group: [], vertex: [], bone: [], uv: [], material: [], impulseCount: 0 };
}

/** Bone indices of the synthetic humanoid, for tests. */
export const BONES = Object.freeze({
  master: 0,
  center: 1,
  upperBody: 2,
  upperBody2: 3,
  neck: 4,
  head: 5,
  leftEye: 6,
  rightEye: 7,
  leftShoulder: 8,
  leftArm: 9,
  leftElbow: 10,
  leftWrist: 11,
  leftIndex1: 12,
  rightShoulder: 13,
  rightArm: 14,
  lowerBody: 18,
  leftLeg: 19,
  leftKnee: 20,
  leftAnkle: 21,
  leftToe: 22,
  rightLeg: 23,
  rightKnee: 24,
  rightAnkle: 25,
  rightToe: 26,
  hair1: 27,
  hair2: 28,
  hair3: 29,
  leftLegD: 30,
  leftKneeD: 31,
  leftAnkleD: 32,
  leftLegIk: 33,
});

/**
 * A small MMD-style humanoid: standard Japanese bone names, arms 35° below
 * horizontal (A-pose), D-bones on the left leg only, a three-bone hair chain
 * with physics, a few morphs, two materials and a BMP texture.
 * @param {{dBones?: boolean}} [options] dBones false leaves out the D-bones and skins the left leg plainly.
 * @returns {{builder: ModelBuilder, model: PmxModel, files: Record<string, Uint8Array>, headVertices: number[]}}
 */
export function syntheticHumanoid({ dBones = true } = {}) {
  const m = new ModelBuilder({ comment: "モデル製作：テスト作者\r\n改変OK", commentEn: "Model: Test Author" });
  const c = Math.cos((35 * Math.PI) / 180);
  const s = Math.sin((35 * Math.PI) / 180);
  m.bone("全ての親", [0, 0, 0], -1, { nameEn: "master" });
  m.bone("センター", [0, 8, 0], 0, { nameEn: "center" });
  m.bone("上半身", [0, 11, 0], 1, { nameEn: "upper body", flags: BONE_FLAGS.tailIsBone, tailBone: 3 });
  m.bone("上半身2", [0, 13, 0], 2, { nameEn: "upper body2" });
  m.bone("首", [0, 16, 0], 3, { nameEn: "neck" });
  m.bone("頭", [0, 17, 0], 4, { nameEn: "head" });
  m.bone("左目", [0.6, 18, -0.8], 5, { nameEn: "eye_L" });
  m.bone("右目", [-0.6, 18, -0.8], 5, { nameEn: "eye_R" });
  for (const [sign, p] of [
    [1, "左"],
    [-1, "右"],
  ]) {
    const shoulder = m.bone(`${p}肩`, [0.4 * sign, 15.5, 0], 3);
    const arm = m.bone(`${p}腕`, [1.5 * sign, 15.3, 0], shoulder, { flags: BONE_FLAGS.localAxis });
    const elbow = m.bone(`${p}ひじ`, [(1.5 + 3 * c) * sign, 15.3 - 3 * s, 0], arm);
    const wrist = m.bone(`${p}手首`, [(1.5 + 5.5 * c) * sign, 15.3 - 5.5 * s, 0], elbow);
    m.bone(`${p}人指１`, [(1.5 + 6.5 * c) * sign, 15.3 - 6.5 * s, 0], wrist);
  }
  m.bone("下半身", [0, 11, 0], 1, { nameEn: "lower body" });
  for (const [sign, p] of [
    [1, "左"],
    [-1, "右"],
  ]) {
    const leg = m.bone(`${p}足`, [0.9 * sign, 10, 0], 18);
    const knee = m.bone(`${p}ひざ`, [0.9 * sign, 5.5, 0], leg);
    const ankle = m.bone(`${p}足首`, [0.9 * sign, 1.2, 0], knee);
    m.bone(`${p}つま先`, [0.9 * sign, 0, -1.2], ankle);
  }
  m.bone("髪1", [0, 18, 1.2], 5, { flags: BONE_FLAGS.fixedAxis });
  m.bone("髪2", [0, 16, 1.6], 27);
  m.bone("髪3", [0, 14, 1.8], 28, { tailOffset: [0, -2, 0.2] });
  if (dBones) {
    const legD = m.bone("左足D", [0.9, 10, 0], 18, { flags: BONE_FLAGS.inheritRotation, inheritParent: 19, inheritWeight: 1 });
    const kneeD = m.bone("左ひざD", [0.9, 5.5, 0], legD);
    m.bone("左足首D", [0.9, 1.2, 0], kneeD);
  } else {
    m.bone("予備1", [3, 0, 0], 0);
    m.bone("予備2", [3, 1, 0], 0);
    m.bone("予備3", [3, 2, 0], 0);
  }
  m.bone("左足ＩＫ", [0.9, 1.2, 0], 0, {
    flags: BONE_FLAGS.ik | BONE_FLAGS.translatable,
    tailOffset: [0, 0, 1],
    ik: {
      target: 21,
      loops: 40,
      limitAngle: 2,
      links: [
        { bone: 20, hasLimits: true, min: [-3.14, 0, 0], max: [-0.01, 0, 0] },
        { bone: 19, hasLimits: false, min: [0, 0, 0], max: [0, 0, 0] },
      ],
    },
  });

  const bodyTexture = m.texture("tex\\Body.bmp");
  m.texture("toon_body.bmp");
  m.material({
    name: "体",
    nameEn: "body",
    ambient: [0.5, 0.5, 0.5],
    specular: [0.1, 0.1, 0.1],
    flags: MATERIAL_FLAGS.edge | MATERIAL_FLAGS.castShadow,
    edgeColor: [0.2, 0.1, 0.1, 1],
    edgeSize: 1,
    textureIndex: bodyTexture,
    sharedToon: false,
    toonIndex: 1,
  });
  const pos = (i) => m.bones[i].position;
  const seg = (bone, child, bone2 = -1) => m.box(pos(bone), child >= 0 ? pos(child) : addv(pos(bone), [0, -1, 0]), 0.35, bone, bone2);
  seg(2, 3);
  seg(3, 4);
  seg(4, 5);
  const headVertices = m.box([0, 16.8, 0], [0, 19.5, 0], 1.4, 5);
  for (const o of [0, 5]) {
    seg(8 + o, 9 + o);
    seg(9 + o, 10 + o, 10 + o);
    seg(10 + o, 11 + o);
    seg(11 + o, 12 + o);
  }
  seg(18, 19);
  if (dBones) {
    seg(30, 31);
    seg(31, 32);
    seg(32, 22);
  } else {
    seg(19, 20);
    seg(20, 21);
    seg(21, 22);
  }
  seg(23, 24);
  seg(24, 25);
  seg(25, 26);
  m.material({
    name: "髪",
    nameEn: "hair",
    diffuse: [0.2, 0.4, 0.9, 0.9],
    ambient: [0.1, 0.2, 0.45],
    flags: MATERIAL_FLAGS.doubleSided,
    sharedToon: true,
    toonIndex: 2,
  });
  seg(27, 28);
  seg(28, 29);
  seg(29, -1);

  // Morphs on the head box; x > 0 is the model's left (+X in MMD, facing -Z).
  const head = (pick) => headVertices.filter((i) => pick(m.vertices[i].position));
  m.vertexMorph("あ", 3, head((p) => p[1] < 17.5), [0, -0.3, 0], "a");
  m.vertexMorph("まばたき", 2, head((p) => p[1] > 18.5), [0, -0.2, 0], "blink");
  m.vertexMorph("ウィンク２", 2, head((p) => p[1] > 18.5 && p[0] > 0), [0, -0.2, 0], "wink2");
  m.vertexMorph("ｳｨﾝｸ２右", 2, head((p) => p[1] > 18.5 && p[0] < 0), [0, -0.2, 0], "wink2_R");
  m.morph("照れ", 4, MORPH_TYPES.material, {
    material: [
      {
        material: 0,
        operation: 0,
        diffuse: [1, 0.8, 0.8, 1],
        specular: [1, 1, 1],
        specularPower: 1,
        ambient: [1, 1, 1],
        edgeColor: [1, 1, 1, 1],
        edgeSize: 1,
        textureTint: [1, 1, 1, 1],
        sphereTint: [1, 1, 1, 1],
        toonTint: [1, 1, 1, 1],
      },
    ],
  });
  m.morph("笑い", 2, MORPH_TYPES.group, {
    group: [
      { morph: 1, weight: 0.5 },
      { morph: 0, weight: 0.3 },
      { morph: 4, weight: 1 },
    ],
  });
  m.morph("首かしげ", 4, MORPH_TYPES.bone, { bone: [{ bone: 4, translation: [0, 0, 0], rotation: [0, 0, Math.sin(0.1), Math.cos(0.1)] }] });
  m.morph("UVスクロール", 4, MORPH_TYPES.uv, { uv: [{ vertex: 0, offset: [0.1, 0, 0, 0] }] });
  m.morph("怒り", 1, MORPH_TYPES.group, {
    group: [
      { morph: 6, weight: 1 },
      { morph: 0, weight: 0.2 },
    ],
  });

  // Physics: head sphere and leg capsules follow their bones; the hair chain is simulated.
  const legBone = dBones ? 30 : 19;
  m.body({ name: "頭", bone: 5, group: 0, shape: 0, size: [1.6, 0, 0], position: [0, 18, 0] });
  m.body({ name: "左足", bone: legBone, group: 1, shape: 2, size: [0.6, 3.5, 0], position: [0.9, 7.75, 0] });
  m.body({ name: "右足", bone: 23, group: 1, shape: 2, size: [0.6, 3.5, 0], position: [-0.9, 7.75, 0] });
  const hairMask = 0xffff & ~(1 << 2) & ~(1 << 1); // not with itself, not with the legs
  m.body({ name: "髪1", bone: 27, group: 2, collisionMask: hairMask, shape: 2, size: [0.3, 1.5, 0], position: [0, 17, 1.4], rotation: [0.2, 0, 0], mass: 0.5, mode: 1 });
  m.body({ name: "髪2", bone: 28, group: 2, collisionMask: hairMask, shape: 0, size: [0.4, 0, 0], position: [0, 15, 1.7], mass: 0.5, mode: 2 });
  m.body({ name: "上半身", bone: 2, group: 0, shape: 1, size: [1.2, 1.5, 0.8], position: [0, 12.5, 0] });
  m.joint({ name: "髪1", bodyA: 0, bodyB: 3, position: [0, 18, 1.2], rotationMin: [-0.5, -0.2, -0.3], rotationMax: [0.5, 0.2, 0.3], rotationSpring: [10, 10, 10] });
  m.joint({ name: "髪2", bodyA: 3, bodyB: 4, position: [0, 16, 1.6], rotationMin: [-0.8, -0.4, -0.4], rotationMax: [0.8, 0.4, 0.4] });

  // One SDEF and one BDEF4 vertex to cover the other weight types.
  m.vertices[0].type = 3;
  m.vertices[0].bones = [2, 3, -1, -1];
  m.vertices[0].weights = [0.7, 0.3, 0, 0];
  m.vertices[1].type = 2;
  m.vertices[1].bones = [2, 3, 2, -1];
  m.vertices[1].weights = [0.5, 0.3, 0.2, 0];

  return { builder: m, model: m.build(), files: { "tex/body.bmp": bmp24(), "toon_body.bmp": toonBmp() }, headVertices };
}

/** A 4×2 24-bit BMP, bottom-up: top row red, green, blue, white; bottom row dark grey. */
export function bmp24() {
  const w = 4;
  const h = 2;
  const stride = 12;
  const out = Buffer.alloc(54 + stride * h);
  out.write("BM", 0, "latin1");
  out.writeInt32LE(54 + stride * h, 2);
  out.writeInt32LE(54, 10);
  out.writeInt32LE(40, 14);
  out.writeInt32LE(w, 18);
  out.writeInt32LE(h, 22);
  out.writeInt16LE(1, 26);
  out.writeInt16LE(24, 28);
  out.writeInt32LE(stride * h, 34);
  // Bottom row first (BGR): dark grey (40, 50, 60).
  for (let x = 0; x < w; x++) out.set([60, 50, 40], 54 + x * 3);
  out.set([0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255], 54 + stride);
  return new Uint8Array(out);
}

/** A 1×8 toon ramp BMP: white above, a warm shadow (200, 160, 150) below the middle. */
export function toonBmp() {
  const h = 8;
  const stride = 4;
  const out = Buffer.alloc(54 + stride * h);
  out.write("BM", 0, "latin1");
  out.writeInt32LE(54 + stride * h, 2);
  out.writeInt32LE(54, 10);
  out.writeInt32LE(40, 14);
  out.writeInt32LE(1, 18);
  out.writeInt32LE(h, 22);
  out.writeInt16LE(1, 26);
  out.writeInt16LE(24, 28);
  // Bottom-up rows: the bottom half is the shadow.
  for (let y = 0; y < h; y++) out.set(y < h / 2 ? [150, 160, 200] : [255, 255, 255], 54 + y * stride);
  return new Uint8Array(out);
}

/**
 * Write a model and its texture files into a folder.
 * @param {string} dir
 * @param {{model: PmxModel, files?: Record<string, Uint8Array>}} parts
 * @param {Parameters<typeof writePmx>[1]} [options]
 * @returns {Promise<string>} The `.pmx` path.
 */
export async function writeModelFolder(dir, { model, files = {} }, options) {
  await mkdir(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), bytes);
  }
  const file = path.join(dir, "model.pmx");
  await writeFile(file, writePmx(model, options));
  return file;
}
