import { REQUIRED_BONES, humanBoneOrder, mapHumanoid } from "./humanoid.mjs";
import { ConversionError, MARKER_EXTENSION, createContext, drop, toGltf } from "./context.mjs";
import { angleDegrees, fromTo, normalize, quatMultiply, quatNormalize, rotate, sub } from "./math.mjs";
import { buildMaterials } from "./materials.mjs";
import { buildMorphTargets } from "./morphs.mjs";
import { setupBodies } from "./physics.mjs";
import { readPmx } from "./reader.mjs";
import { uniqueName } from "./names.mjs";
import { loadTextures } from "./textures.mjs";
import { buildVrm } from "./vrm.mjs";

export { ConversionError, MARKER_EXTENSION, MMD_UNIT_METRES } from "./context.mjs";

/**
 * @typedef {import("./context.mjs").Context} Context
 * @typedef {import("./context.mjs").ConvertOptions} ConvertOptions
 * @typedef {import("./context.mjs").ConvertReport} ConvertReport
 * @typedef {import("./math.mjs").Vec3} Vec3
 * @typedef {import("./math.mjs").Quat} Quat
 */

/**
 * PMX to VRM 1.0. Everything first moves into glTF space (metres,
 * right-handed, Y up, facing +Z, feet on y = 0), the arms are baked into a
 * T-pose, and then the mesh, skin, materials, morph targets, humanoid and
 * metadata are written, with the expressions, springs and look-at that other
 * modules leave in the context. Ported from pmx-to-vrm's `Converter` (MIT).
 */

/**
 * Convert a PMX model's bytes to a VRM 1.0 GLB.
 * @param {Uint8Array} bytes
 * @param {ConvertOptions} options
 * @returns {{glb: Buffer, report: ConvertReport}}
 */
export function convertPmx(bytes, options) {
  const model = readPmx(bytes);
  const ctx = createContext(model, options);
  if (model.softBodyCount > 0) drop(ctx, "PMX 2.1 soft bodies", model.softBodyCount);
  setupSkeleton(ctx);
  setupGeometry(ctx);
  ctx.bodies = setupBodies(model, ctx.boneCount, ctx.unit, ctx.report.warnings);
  ctx.simulated = new Array(ctx.boneCount).fill(false);
  for (const body of ctx.bodies) if (body.mode !== 0 && body.bone >= 0) ctx.simulated[body.bone] = true;
  ctx.human = mapHumanoid(model, ctx.parent, ctx.simulated, ctx.report.warnings);
  const missing = REQUIRED_BONES.filter((bone) => !ctx.human.has(bone));
  ctx.report.humanBones = humanBoneOrder().filter((bone) => ctx.human.has(bone));
  ctx.report.missingRequired = missing;
  if (missing.length > 0)
    throw Object.assign(
      new ConversionError(`The model lacks bones VRM requires: ${missing.join(", ")}. MMD's standard bone names (上半身, 頭, 左腕 …) were not found for them.`),
      { report: ctx.report },
    );
  checkFacing(ctx);
  bakeRestPose(ctx);
  placeHips(ctx);
  ground(ctx);

  ctx.textures = loadTextures(model.textures, options.baseDir);
  const materials = buildMaterials(ctx);
  const targets = buildMorphTargets(ctx);
  const meshNode = ctx.boneCount + ctx.extraNodes.length;
  buildMesh(ctx, materials, targets);
  buildNodes(ctx, meshNode);
  for (const texture of ctx.textures)
    if (texture.problem && ctx.usedTextures.has(texture)) ctx.report.missingTextures.push({ stored: texture.stored, problem: texture.problem });

  const extensionsUsed = ["VRMC_vrm", "VRMC_materials_mtoon", MARKER_EXTENSION];
  /** @type {Record<string, unknown>} */
  const extensions = {
    VRMC_vrm: buildVrm(ctx, { meshNode, materials, targets }),
    [MARKER_EXTENSION]: { source: "pmx", converter: options.converterVersion },
  };
  if (ctx.springBone) {
    extensions.VRMC_springBone = ctx.springBone;
    extensionsUsed.push("VRMC_springBone");
  }
  const sceneNodes = [];
  for (let i = 0; i < ctx.boneCount; i++) if (ctx.parent[i] < 0) sceneNodes.push(i);
  sceneNodes.push(meshNode);
  const glb = ctx.builder.toGlb({
    asset: { version: "2.0", generator: `animama-avatar-converter ${options.converterVersion}` },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    extensionsUsed,
    extensions,
  });
  return { glb, report: ctx.report };
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

/** @param {Context} ctx */
function setupSkeleton(ctx) {
  const { model } = ctx;
  if (model.bones.length === 0) {
    // A model without bones still gets one, so the skin has something to hold.
    model.bones.push({
      name: "root",
      nameEn: "root",
      position: [0, 0, 0],
      parent: -1,
      layer: 0,
      flags: 0,
      tailBone: -1,
      tailOffset: [0, 0, 0],
      inheritParent: -1,
      inheritWeight: 0,
      ik: null,
    });
    ctx.report.warnings.push("The model has no bones; added a root bone.");
  }
  const n = model.bones.length;
  if (n > 65535) throw new ConversionError(`The model has ${n} bones; at most 65,535 can be skinned.`);
  ctx.boneCount = n;
  ctx.parent = new Int32Array(n);
  ctx.bonePos = model.bones.map((bone) => toGltf(ctx, bone.position));
  model.bones.forEach((bone, i) => {
    ctx.parent[i] = bone.parent >= 0 && bone.parent < n && bone.parent !== i ? bone.parent : -1;
  });
  // Cut parent loops.
  for (let i = 0; i < n; i++) {
    const seen = new Set([i]);
    for (let p = ctx.parent[i]; p >= 0; p = ctx.parent[p])
      if (seen.has(p)) {
        ctx.report.warnings.push(`Bone parent loop at '${model.bones[i].name}'; cut.`);
        ctx.parent[i] = -1;
        break;
      } else seen.add(p);
  }
  ctx.children = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) if (ctx.parent[i] >= 0) ctx.children[ctx.parent[i]].push(i);
  const queue = [];
  for (let i = 0; i < n; i++) if (ctx.parent[i] < 0) queue.push(i);
  for (let head = 0; head < queue.length; head++) queue.push(...ctx.children[queue[head]]);
  ctx.order = queue;
  const used = new Set();
  ctx.nodeNames = model.bones.map((bone, i) => uniqueName(bone.name || bone.nameEn || `bone${i}`, used));
}

/** @param {Context} ctx */
function setupGeometry(ctx) {
  const { model } = ctx;
  const n = model.vertexCount;
  ctx.positions = new Float32Array(n * 3);
  ctx.normals = new Float32Array(n * 3);
  ctx.uvs = new Float32Array(n * 2);
  ctx.joints = new Uint16Array(n * 4);
  ctx.weights = new Float32Array(n * 4);
  const tmpBones = [0, 0, 0, 0];
  const tmpWeights = [0, 0, 0, 0];
  let unweighted = 0;
  let sdef = 0;
  for (let v = 0; v < n; v++) {
    const p = v * 3;
    ctx.positions[p] = model.positions[p] * ctx.unit;
    ctx.positions[p + 1] = model.positions[p + 1] * ctx.unit;
    ctx.positions[p + 2] = -model.positions[p + 2] * ctx.unit;
    const normal = normalize([model.normals[p], model.normals[p + 1], -model.normals[p + 2]]);
    ctx.normals.set(normal, p);
    ctx.uvs[v * 2] = Number.isFinite(model.uvs[v * 2]) ? model.uvs[v * 2] : 0;
    ctx.uvs[v * 2 + 1] = Number.isFinite(model.uvs[v * 2 + 1]) ? model.uvs[v * 2 + 1] : 0;
    if (model.weightTypes[v] === 3) sdef += 1;
    let k = 0;
    for (let s = 0; s < 4; s++) {
      const bone = model.skinBones[v * 4 + s];
      const weight = model.skinWeights[v * 4 + s];
      if (bone < 0 || bone >= ctx.boneCount || !(weight > 0)) continue;
      const at = tmpBones.slice(0, k).indexOf(bone);
      if (at >= 0) tmpWeights[at] += weight;
      else {
        tmpBones[k] = bone;
        tmpWeights[k] = weight;
        k++;
      }
    }
    let sum = 0;
    for (let s = 0; s < k; s++) sum += tmpWeights[s];
    if (k === 0 || sum <= 0) {
      unweighted += 1;
      tmpBones[0] = 0;
      tmpWeights[0] = 1;
      k = 1;
      sum = 1;
    }
    for (let s = 0; s < 4; s++) {
      ctx.joints[v * 4 + s] = s < k ? tmpBones[s] : 0;
      ctx.weights[v * 4 + s] = s < k ? tmpWeights[s] / sum : 0;
    }
  }
  if (unweighted > 0) ctx.report.warnings.push(`${unweighted} vertices had no bone weights; bound to the first bone.`);
  if (sdef > 0) drop(ctx, "SDEF skinning (converted as linear skinning)", sdef);
}

/** The model's left arm should be on +X (MMD models face -Z; after the mirror, +Z). @param {Context} ctx */
function checkFacing(ctx) {
  const left = ctx.human.get("leftUpperArm");
  const right = ctx.human.get("rightUpperArm");
  if (left !== undefined && right !== undefined && ctx.bonePos[left][0] < ctx.bonePos[right][0])
    ctx.report.warnings.push("The left arm is on the -X side: this model may face +Z in MMD (unusual), so it will face backwards.");
}

// ─── Rest pose ───────────────────────────────────────────────────────────────

/**
 * Bake a T-pose: each arm segment rotates about its own joint until it points
 * along +X (left) or -X (right); every descendant bone, vertex, morph offset
 * and rigid body follows. Afterwards every node has translation only.
 * @param {Context} ctx
 */
function bakeRestPose(ctx) {
  const n = ctx.boneCount;
  ctx.bakeRotation = Array.from({ length: n }, () => /** @type {Quat} */ ([0, 0, 0, 1]));
  ctx.bakeTranslation = Array.from({ length: n }, () => /** @type {Vec3} */ ([0, 0, 0]));
  if (ctx.options.keepPose) return;
  /** @type {Map<number, {child: number, target: Vec3}>} */
  const straighten = new Map();
  for (const [side, sign] of [
    ["left", 1],
    ["right", -1],
  ]) {
    /** @type {Vec3} */
    const target = [sign, 0, 0];
    const segment = (from, ...tos) => {
      const a = ctx.human.get(side + from);
      if (a === undefined) return;
      for (const to of tos) {
        const b = ctx.human.get(side + to);
        if (b !== undefined) {
          straighten.set(a, { child: b, target });
          return;
        }
      }
    };
    segment("UpperArm", "LowerArm");
    segment("LowerArm", "Hand");
    segment("Hand", "MiddleProximal", "IndexProximal", "RingProximal");
  }
  if (straighten.size === 0) return;
  /** @type {Vec3[]} */
  const newPos = new Array(n);
  let rotated = 0;
  let maxAngle = 0;
  for (const b of ctx.order) {
    const p = ctx.parent[b];
    const qp = p >= 0 ? ctx.bakeRotation[p] : /** @type {Quat} */ ([0, 0, 0, 1]);
    const tp = p >= 0 ? ctx.bakeTranslation[p] : /** @type {Vec3} */ ([0, 0, 0]);
    const transform = (point) => {
      const r = rotate(qp, point);
      return /** @type {Vec3} */ ([r[0] + tp[0], r[1] + tp[1], r[2] + tp[2]]);
    };
    const pivot = transform(ctx.bonePos[b]);
    newPos[b] = pivot;
    const s = straighten.get(b);
    if (s) {
      const dir = sub(transform(ctx.bonePos[s.child]), pivot);
      if (dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2 > 1e-10) {
        const r = fromTo(normalize(dir), s.target);
        const angle = angleDegrees(r);
        if (angle > 0.3) {
          ctx.bakeRotation[b] = quatNormalize(quatMultiply(r, qp));
          const moved = rotate(r, sub(tp, pivot));
          ctx.bakeTranslation[b] = [moved[0] + pivot[0], moved[1] + pivot[1], moved[2] + pivot[2]];
          rotated += 1;
          maxAngle = Math.max(maxAngle, angle);
          continue;
        }
      }
    }
    ctx.bakeRotation[b] = qp;
    ctx.bakeTranslation[b] = tp;
  }
  if (rotated === 0) return;
  ctx.bonePos = newPos;
  const { positions, normals, joints, weights } = ctx;
  for (let v = 0; v < positions.length / 3; v++) {
    const point = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const normal = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    const p = [0, 0, 0];
    const nn = [0, 0, 0];
    for (let s = 0; s < 4; s++) {
      const w = weights[v * 4 + s];
      if (w <= 0) continue;
      const bone = joints[v * 4 + s];
      const q = ctx.bakeRotation[bone];
      const t = ctx.bakeTranslation[bone];
      const rp = rotate(q, point);
      const rn = rotate(q, normal);
      for (let k = 0; k < 3; k++) {
        p[k] += w * (rp[k] + t[k]);
        nn[k] += w * rn[k];
      }
    }
    positions.set(p, v * 3);
    normals.set(normalize(/** @type {Vec3} */ (nn)), v * 3);
  }
  for (const body of ctx.bodies) {
    if (body.bone < 0) continue;
    const q = ctx.bakeRotation[body.bone];
    const t = ctx.bakeTranslation[body.bone];
    const c = rotate(q, body.center);
    body.center = [c[0] + t[0], c[1] + t[1], c[2] + t[2]];
    body.axisX = rotate(q, body.axisX);
    body.axisY = rotate(q, body.axisY);
    body.axisZ = rotate(q, body.axisZ);
  }
  ctx.report.notes.push(`Rest pose: ${rotated} arm segments straightened into a T-pose (largest turn ${Math.round(maxAngle)}°).`);
}

/**
 * MMD's センター usually sits near the knees; VRM expects the hips between
 * the legs and the spine. Only the node's pivot moves: the skin follows,
 * because the bind matrices use the same position.
 * @param {Context} ctx
 */
function placeHips(ctx) {
  const hips = ctx.human.get("hips");
  const spine = ctx.human.get("spine");
  const leftLeg = ctx.human.get("leftUpperLeg");
  const rightLeg = ctx.human.get("rightUpperLeg");
  if (hips === undefined || spine === undefined || leftLeg === undefined || rightLeg === undefined) return;
  const legs = [0, 1, 2].map((k) => (ctx.bonePos[leftLeg][k] + ctx.bonePos[rightLeg][k]) / 2);
  const top = Math.max(ctx.bonePos[spine][1], legs[1]);
  const y = ctx.bonePos[hips][1];
  if (y >= legs[1] - 1e-4 && y <= top + 1e-4) return;
  ctx.bonePos[hips] = [legs[0], (legs[1] + top) / 2, legs[2]];
  ctx.report.notes.push(`Moved the hips pivot ('${ctx.model.bones[hips].name}') between the legs and the spine.`);
}

/** Move the model so its lowest vertex stands on y = 0. @param {Context} ctx */
function ground(ctx) {
  const { positions } = ctx;
  if (positions.length === 0) return;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]);
    max = Math.max(max, positions[i]);
  }
  ctx.report.model.heightMetres = max - min;
  if (Math.abs(min) < 1e-4) return;
  for (let i = 1; i < positions.length; i += 3) positions[i] -= min;
  for (const p of ctx.bonePos) p[1] -= min;
  for (const body of ctx.bodies) body.center[1] -= min;
}

// ─── Mesh and nodes ──────────────────────────────────────────────────────────

/**
 * @param {Context} ctx
 * @param {{gltfIndex: number}[]} materials glTF material per PMX material.
 * @param {import("./morphs.mjs").MorphTarget[]} targets
 */
function buildMesh(ctx, materials, targets) {
  const { builder: g, model } = ctx;
  const vertexCount = model.vertexCount;
  const position = g.addFloats(ctx.positions, "VEC3", true);
  const normal = g.addFloats(ctx.normals, "VEC3");
  const uv = g.addFloats(ctx.uvs, "VEC2");
  const joints = g.addJoints(ctx.joints);
  const weights = g.addFloats(ctx.weights, "VEC4");
  const targetAccessors = targets.map((t) => g.addSparseVec3(vertexCount, t.vertices, t.offsets));
  const targetNames = targets.map((t) => t.name);
  const primitives = [];
  let offset = 0;
  model.materials.forEach((material, m) => {
    const start = offset;
    offset += material.indexCount;
    const indices = [];
    for (let f = start; f + 2 < start + material.indexCount; f += 3) {
      const a = model.indices[f];
      const b = model.indices[f + 1];
      const c = model.indices[f + 2];
      if (a === b || b === c || a === c) continue; // degenerate
      // MMD front faces are clockwise; mirroring Z keeps the image, so glTF (counter-clockwise) needs them reversed.
      indices.push(a, c, b);
    }
    if (indices.length === 0) return;
    /** @type {Record<string, unknown>} */
    const primitive = {
      attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv, JOINTS_0: joints, WEIGHTS_0: weights },
      indices: g.addIndices(Uint32Array.from(indices), vertexCount),
      material: materials[m].gltfIndex,
      mode: 4,
    };
    if (targetAccessors.length > 0) {
      primitive.targets = targetAccessors.map((accessor) => ({ POSITION: accessor }));
      primitive.extras = { targetNames };
    }
    primitives.push(primitive);
  });
  if (primitives.length === 0) throw new ConversionError("The model has no faces to draw.");
  /** @type {Record<string, unknown>} */
  const mesh = { name: "Body", primitives };
  if (targets.length > 0) {
    mesh.weights = targets.map(() => 0);
    mesh.extras = { targetNames };
  }
  g.meshes.push(mesh);
  ctx.report.morphTargets = targets.length;
}

/**
 * Bone nodes (translation only), extra nodes such as spring tails, the mesh
 * node and the skin.
 * @param {Context} ctx
 * @param {number} meshNode
 */
function buildNodes(ctx, meshNode) {
  const { builder: g } = ctx;
  for (let i = 0; i < ctx.boneCount; i++) {
    const parent = ctx.parent[i];
    const t = parent >= 0 ? sub(ctx.bonePos[i], ctx.bonePos[parent]) : ctx.bonePos[i];
    /** @type {Record<string, unknown>} */
    const node = { name: ctx.nodeNames[i], translation: t.map(clean) };
    const children = [...ctx.children[i]];
    ctx.extraNodes.forEach((extra, k) => {
      if (extra.parent === i) children.push(ctx.boneCount + k);
    });
    if (children.length > 0) node.children = children;
    g.nodes.push(node);
  }
  for (const extra of ctx.extraNodes)
    g.nodes.push({ name: extra.name, translation: sub(extra.position, ctx.bonePos[extra.parent]).map(clean) });
  g.nodes.push({ name: "Body", mesh: 0, skin: 0 });
  const inverseBind = new Float32Array(ctx.boneCount * 16);
  for (let i = 0; i < ctx.boneCount; i++) {
    const o = i * 16;
    inverseBind[o] = 1;
    inverseBind[o + 5] = 1;
    inverseBind[o + 10] = 1;
    inverseBind[o + 15] = 1;
    inverseBind[o + 12] = -ctx.bonePos[i][0];
    inverseBind[o + 13] = -ctx.bonePos[i][1];
    inverseBind[o + 14] = -ctx.bonePos[i][2];
  }
  const roots = [];
  for (let i = 0; i < ctx.boneCount; i++) if (ctx.parent[i] < 0) roots.push(i);
  /** @type {Record<string, unknown>} */
  const skin = { name: "Armature", inverseBindMatrices: g.addMatrices(inverseBind), joints: Array.from({ length: ctx.boneCount }, (_, i) => i) };
  if (roots.length === 1) skin.skeleton = roots[0];
  g.skins.push(skin);
}

/** A float for node JSON: finite and never -0. Not rounded, so node positions match the bind matrices. */
function clean(value) {
  return Number.isFinite(value) && value !== 0 ? value : 0;
}
