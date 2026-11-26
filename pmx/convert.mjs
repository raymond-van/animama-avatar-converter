import { REQUIRED_BONES, humanBoneOrder, mapHumanoid } from "./humanoid.mjs";
import { ConversionError, MARKER_EXTENSION, createContext, drop, toGltf } from "./context.mjs";
import { angleDegrees, fromTo, normalize, quatMultiply, quatNormalize, rotate, sub } from "./math.mjs";
import { buildMaterials, edgelessVariant } from "./materials.mjs";
import { buildExpressions, planBoneFreeCopies } from "./expressions.mjs";
import { addBoneFreeCopies, buildMorphTargets, countDropped, planMorphs } from "./morphs.mjs";
import { buildLookAt, planLookAt } from "./lookat.mjs";
import { buildSprings, setupBodies } from "./physics.mjs";
import { followIkChains } from "./rig.mjs";
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
  // Physics on a bone the humanoid needs (a neck, say) is left off: it follows the animation,
  // and its body becomes a collider.
  const wouldBeHuman = mapHumanoid(model, ctx.parent, new Array(ctx.boneCount).fill(false), []);
  const demoted = [...new Set(wouldBeHuman.values())].filter((bone) => ctx.simulated[bone]);
  for (const bone of demoted) ctx.simulated[bone] = false;
  if (demoted.length > 0)
    ctx.report.warnings.push(`Physics on humanoid bones was left off; they follow the animation: ${demoted.map((b) => `'${model.bones[b].name}'`).join(", ")}.`);
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
  // Before the bake, so bones moved to follow the arms straighten with them.
  followIkChains(ctx);
  bakeRestPose(ctx);
  placeHips(ctx);
  ground(ctx);
  // Before bone morphs and springs read the hierarchy: look-at may move bones under the eyes.
  const lookAt = planLookAt(ctx);
  buildSprings(ctx);

  ctx.textures = loadTextures(model.textures, options.baseDir);
  const plan = planMorphs(ctx);
  const materials = buildMaterials(ctx, plan.alphaAnimated, plan.revealed);
  const targets = buildMorphTargets(ctx, plan);
  // Copies without bone parts for moods whose parts turn the same bones (see composeFace).
  addBoneFreeCopies(ctx, plan, targets, planBoneFreeCopies(ctx, plan, targets));
  buildLookAt(ctx, lookAt, targets);
  countDropped(ctx, plan);
  const meshes = buildMeshes(ctx, materials, targets, ctx.boneCount + ctx.extraNodes.length);
  buildExpressions(ctx, { plan, targets, materials, meshes });
  buildNodes(ctx, meshes);
  for (const texture of ctx.textures)
    if (texture.problem && ctx.usedTextures.has(texture)) ctx.report.missingTextures.push({ stored: texture.stored, problem: texture.problem });

  const extensionsUsed = ["VRMC_vrm", "VRMC_materials_mtoon", MARKER_EXTENSION];
  /** @type {Record<string, unknown>} */
  const extensions = {
    VRMC_vrm: buildVrm(ctx, { meshes }),
    [MARKER_EXTENSION]: { source: "pmx", converter: options.converterVersion },
  };
  if (ctx.springBone) {
    extensions.VRMC_springBone = ctx.springBone;
    extensionsUsed.push("VRMC_springBone");
  }
  const sceneNodes = [];
  for (let i = 0; i < ctx.boneCount; i++) if (ctx.parent[i] < 0) sceneNodes.push(i);
  sceneNodes.push(...meshes.map((m) => m.node));
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
 * @typedef {object} MeshNode
 * @property {number} node The mesh's node.
 * @property {number} mesh
 * @property {string} name The material's name (or "Transparent"), made unique.
 * @property {Map<number, number>} targets Morph target (index into `targets`) to this mesh's own index.
 */

/** What a viewer may expand morph targets to (Animama refuses a file above it). */
export const MORPH_EXPANSION_LIMIT = 100 * 1024 * 1024;

/**
 * One mesh per opaque PMX material, holding only the vertices its faces use
 * and only the morph targets that move them: a glTF reader expands each
 * sparse target to its mesh's whole vertex count, so one mesh for the model
 * would multiply every target by every vertex (Animama caps that expansion at
 * 100 MB). Blended materials that tie on render order (MToon's queue offset
 * stops at 9, and materials hidden at rest share one) share a mesh, in PMX
 * order: a viewer sorts tied meshes by depth, but draws the primitives of one
 * mesh in order, as MMD draws its materials.
 *
 * An outlined material puts faces whose vertices MMD draws without an edge
 * (per-vertex edge scale under a half) in a second primitive with the
 * material's outline-free copy, except on the head: Animama finds the face
 * skin as one primitive, so a face material keeps its outline throughout.
 * @param {Context} ctx
 * @param {import("./materials.mjs").MaterialInfo[]} materials glTF material per PMX material.
 * @param {import("./morphs.mjs").MorphTarget[]} targets
 * @param {number} firstNode The node index the first mesh's node gets.
 * @returns {MeshNode[]}
 */
function buildMeshes(ctx, materials, targets, firstNode) {
  const { builder: g, model } = ctx;
  /** Each PMX vertex's index in the mesh being built, -1 outside it. */
  const local = new Int32Array(model.vertexCount).fill(-1);
  const usedNames = new Set([...ctx.nodeNames, ...ctx.extraNodes.map((extra) => extra.name)]);
  const onHead = headBones(ctx);

  // Each material's faces (glTF winding), split by outline.
  /** @type {{material: number, faces: number[], edgeless: number[]}[]} */
  const parts = [];
  let offset = 0;
  let widthLost = 0;
  model.materials.forEach((material, m) => {
    const start = offset;
    offset += material.indexCount;
    const faces = [];
    const edgeless = [];
    /** @type {number[]} */
    const all = [];
    for (let f = start; f + 2 < start + material.indexCount; f += 3) {
      const a = model.indices[f];
      const b = model.indices[f + 1];
      const c = model.indices[f + 2];
      if (a === b || b === c || a === c) continue; // degenerate
      // MMD front faces are clockwise; mirroring Z keeps the image, so glTF (counter-clockwise) needs them reversed.
      all.push(a, c, b);
    }
    const splits = materials[m].outlined && !mostlyOn(ctx, all, onHead);
    for (let i = 0; i < all.length; i += 3) {
      const face = [all[i], all[i + 1], all[i + 2]];
      const noEdge = splits && face.every((v) => model.edgeScales[v] < 0.5);
      (noEdge ? edgeless : faces).push(...face);
    }
    // Outlined vertices whose own width (a fraction, or none where kept outlined) is lost.
    if (materials[m].outlined) for (const v of new Set(faces)) if (Math.abs(model.edgeScales[v] - 1) > 0.01) widthLost += 1;
    if (faces.length + edgeless.length > 0) parts.push({ material: m, faces, edgeless });
  });
  drop(ctx, "per-vertex outline width (vertices drawn at full width)", widthLost);
  if (parts.length === 0) throw new ConversionError("The model has no faces to draw.");

  // A mesh per material, except blended materials that tie on render order: those share one,
  // at the first one's place.
  /** @type {typeof parts[]} */
  const groups = [];
  /** @type {Map<string, typeof parts>} */
  const ties = new Map();
  for (const part of parts) {
    const info = materials[part.material];
    const mtoon = g.materials[info.gltfIndex].extensions.VRMC_materials_mtoon;
    if (info.alphaMode !== "BLEND") {
      groups.push([part]);
      continue;
    }
    const key = `${mtoon.transparentWithZWrite}:${mtoon.renderQueueOffsetNumber}`;
    const group = ties.get(key);
    if (group) group.push(part);
    else {
      ties.set(key, [part]);
      groups.push(/** @type {typeof parts} */ (ties.get(key)));
    }
  }

  /** @type {MeshNode[]} */
  const meshes = [];
  let expanded = 0;
  for (const group of groups) {
    // In PMX order, so a target's sorted vertices stay sorted here.
    const vertices = Uint32Array.from(new Set(group.flatMap((part) => [...part.faces, ...part.edgeless]))).sort();
    vertices.forEach((v, i) => (local[v] = i));
    const pick = (/** @type {Float32Array | Uint16Array} */ data, size) => {
      const out = new /** @type {any} */ (data.constructor)(vertices.length * size);
      vertices.forEach((v, i) => out.set(data.subarray(v * size, v * size + size), i * size));
      return out;
    };
    /** @type {Record<string, unknown>} */
    const attributes = {
      POSITION: g.addFloats(pick(ctx.positions, 3), "VEC3", true),
      NORMAL: g.addFloats(pick(ctx.normals, 3), "VEC3"),
      TEXCOORD_0: g.addFloats(pick(ctx.uvs, 2), "VEC2"),
      JOINTS_0: g.addJoints(pick(ctx.joints, 4)),
      WEIGHTS_0: g.addFloats(pick(ctx.weights, 4), "VEC4"),
    };
    /** @type {Record<string, unknown>[]} */
    const primitives = [];
    for (const part of group)
      for (const [list, outlineFree] of /** @type {const} */ ([
        [part.faces, false],
        [part.edgeless, true],
      ])) {
        if (list.length === 0) continue;
        primitives.push({
          attributes,
          indices: g.addIndices(Uint32Array.from(list, (v) => local[v]), vertices.length),
          material: outlineFree ? edgelessVariant(ctx, materials[part.material]) : materials[part.material].gltfIndex,
          mode: 4,
        });
      }
    /** @type {Map<number, number>} */
    const own = new Map();
    const accessors = [];
    const names = [];
    targets.forEach((target, t) => {
      const keep = [];
      for (let i = 0; i < target.vertices.length; i++) if (local[target.vertices[i]] >= 0) keep.push(i);
      if (keep.length === 0) return;
      const offsets = new Float32Array(keep.length * 3);
      keep.forEach((i, k) => offsets.set(target.offsets.subarray(i * 3, i * 3 + 3), k * 3));
      own.set(t, accessors.length);
      accessors.push(g.addSparseVec3(vertices.length, Uint32Array.from(keep, (i) => local[target.vertices[i]]), offsets));
      names.push(target.name);
    });
    for (const v of vertices) local[v] = -1;
    expanded += vertices.length * 12 * accessors.length;
    const first = model.materials[group[0].material];
    const name = uniqueName(group.length > 1 ? "Transparent" : first.name || first.nameEn || `material${group[0].material}`, usedNames);
    /** @type {Record<string, unknown>} */
    const mesh = { name, primitives };
    if (accessors.length > 0) {
      for (const primitive of primitives) {
        primitive.targets = accessors.map((accessor) => ({ POSITION: accessor }));
        primitive.extras = { targetNames: names };
      }
      mesh.weights = accessors.map(() => 0);
      mesh.extras = { targetNames: names };
    }
    g.meshes.push(mesh);
    meshes.push({ node: firstNode + meshes.length, mesh: g.meshes.length - 1, name, targets: own });
  }
  // A target on vertices no face draws is in no mesh: it shows nothing.
  // Bone-free copies are no face morphs of their own: they are left out of both counts.
  const faces = targets.filter((target) => target.boneFreeOf === undefined);
  const shown = targets.filter((target, t) => target.boneFreeOf === undefined && meshes.some((mesh) => mesh.targets.has(t))).length;
  drop(ctx, "morph targets that move only vertices no face uses", faces.length - shown);
  ctx.report.morphTargets = shown;
  if (expanded > (ctx.options.morphExpansionLimit ?? MORPH_EXPANSION_LIMIT))
    ctx.report.warnings.push(
      `The morph targets expand to ${Math.round(expanded / 1024 / 1024)} MB in a viewer; Animama accepts at most 100 MB. A material with fewer vertices or fewer face morphs would fit.`,
    );
  return meshes;
}

/** The head bone and every bone below it. */
function headBones(ctx) {
  const head = ctx.human.get("head");
  const out = new Set();
  if (head === undefined) return out;
  const queue = [head];
  for (let i = 0; i < queue.length; i++) {
    out.add(queue[i]);
    queue.push(...ctx.children[queue[i]]);
  }
  return out;
}

/** Whether most of these vertices hang mainly from the given bones. */
function mostlyOn(ctx, vertices, bones) {
  const unique = new Set(vertices);
  if (unique.size === 0 || bones.size === 0) return false;
  let on = 0;
  for (const v of unique) {
    let best = 0;
    for (let s = 1; s < 4; s++) if (ctx.weights[v * 4 + s] > ctx.weights[v * 4 + best]) best = s;
    if (bones.has(ctx.joints[v * 4 + best])) on += 1;
  }
  return on * 2 > unique.size;
}

/**
 * Bone nodes (translation only), extra nodes such as spring tails, the mesh
 * nodes and the skin they share.
 * @param {Context} ctx
 * @param {MeshNode[]} meshes
 */
function buildNodes(ctx, meshes) {
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
  for (const { name, mesh } of meshes) g.nodes.push({ name, mesh, skin: 0 });
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
