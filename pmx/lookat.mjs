import { length, rotate, sub } from "./math.mjs";
import { uniqueName } from "./names.mjs";

/**
 * Look-at (R7), tried in order:
 * 1. bone: the eye bones, and the bones below them, carry the eyes;
 * 2. re-parented bone: bones beside the eyes (separate pupil or highlight
 *    bones) carry part of them; they are moved under the eye bones;
 * 3. expression: the eye bones cannot turn the eyes whole (or there are none),
 *    so lookUp/Down/Left/Right morph targets turn the eye meshes instead;
 * 4. none: no eye meshes (eyes painted on the face).
 */

/** @typedef {import("./math.mjs").Vec3} Vec3 */

/** How far the eyes turn at the range maps' full input, in degrees (VRM's usual 10°). */
export const EYE_TURN_DEGREES = 10;
const RANGE_INPUT_DEGREES = 90;

/** Materials that are the moving parts of an eye, and those that are not. */
const EYE_MATERIAL = /瞳|虹彩|黒目|くろめ|眼睛|眼珠|iris|pupil|ハイライト|highlight|^目$|^眼$|^eyes?(?:[_ .-]?[lr])?$|眼球|eyeball|目玉/i;
const NOT_EYE_MATERIAL = /白目|しろめ|white|睫|まつ毛|まつげ|lash|眉|brow|影|shadow|涙|tear/i;

/**
 * @typedef {object} EyePart
 * @property {"left" | "right"} side
 * @property {number} eye The eye bone, or -1 when found by material.
 * @property {Set<number>} vertices
 * @property {Vec3} pivot What the part turns about: the eye bone, or a guess behind the part.
 */

/**
 * @typedef {object} LookAtPlan
 * @property {"bone" | "expression" | "none"} type
 * @property {EyePart[]} parts
 * @property {number[]} adopted Bones moved under the eye bones.
 * @property {string} summary For the report.
 */

/**
 * Decide the look-at, moving bones beside the eyes under the eye bones when
 * that lets the eye bones turn the eyes whole. Call after the rest-pose bake
 * and grounding, and before bone morphs and springs read the hierarchy.
 * @param {import("./context.mjs").Context} ctx
 * @returns {LookAtPlan}
 */
export function planLookAt(ctx) {
  const head = ctx.human.get("head");
  if (head === undefined) return none("the model has no head bone.");
  const mesh = meshIndex(ctx);
  const eyes = /** @type {const} */ (["left", "right"]).map((side) => ctx.human.get(`${side}Eye`));
  /** @type {string | null} Why the eye bones cannot turn the eyes, when they exist. */
  let boneProblem = null;
  if (eyes[0] !== undefined && eyes[1] !== undefined) {
    const sides = /** @type {const} */ (["left", "right"]).map((side, k) => eyeBonePart(ctx, mesh, side, /** @type {number} */ (eyes[k]), /** @type {number} */ (eyes[1 - k])));
    if (sides.every((s) => s.part)) {
      // One bone may carry part of both eyes: count it once.
      const stuck = [...new Map(sides.flatMap((s) => s.stuck).map((entry) => [entry.bone, entry])).values()];
      if (stuck.length === 0) {
        const adopted = sides.flatMap((s) => s.adopted);
        for (const s of sides) for (const bone of s.adopted) reparent(ctx, bone, /** @type {EyePart} */ (s.part).eye);
        const names = (bones) => bones.map((b) => `'${ctx.model.bones[b].name}'`).join(", ");
        const stretch = sides.reduce((sum, s) => sum + s.stretch, 0);
        const summary =
          adopted.length > 0
            ? `bone (${names(eyes)}), with ${adopted.length} bones beside the eyes moved under them (${names(adopted.slice(0, 4))}${adopted.length > 4 ? " …" : ""}).`
            : `bone (${names(eyes)}).`;
        return {
          type: "bone",
          parts: sides.map((s) => /** @type {EyePart} */ (s.part)),
          adopted,
          summary: stretch > 0 ? `${summary} ${stretch} eye vertices also follow the head and stretch as the eyes turn, as in MMD.` : summary,
        };
      }
      const first = stuck[0];
      boneProblem = `${stuck.length > 1 ? `${stuck.length} bones that carry part of the eyes cannot move under the eye bones; '${ctx.model.bones[first.bone].name}', for one,` : `'${ctx.model.bones[first.bone].name}' carries part of an eye but`} ${first.reason}`;
      const parts = sides.map((s) => /** @type {EyePart} */ (s.part));
      return { type: "expression", parts, adopted: [], summary: expressionSummary(boneProblem) };
    }
    boneProblem = "the eye bones carry no eye mesh";
  } else boneProblem = "the model has no eye bones (左目, 右目)";

  const parts = materialParts(ctx, mesh, head);
  if (parts.length === 2) return { type: "expression", parts, adopted: [], summary: expressionSummary(boneProblem) };
  return none(`${boneProblem}, and no eye material (瞳, iris …) was found to turn; the eyes may be painted on the face.`);
}

const none = (why) => /** @type {LookAtPlan} */ ({ type: "none", parts: [], adopted: [], summary: `none: ${why}` });
const expressionSummary = (why) => `expression (lookUp/Down/Left/Right morph targets turn the eye meshes, because ${why}).`;

/**
 * Write the look-at's morph targets (expression look-at only) and VRMC_vrm
 * lookAt into the context. Call once the PMX morph targets are built.
 * @param {import("./context.mjs").Context} ctx
 * @param {LookAtPlan} plan
 * @param {import("./morphs.mjs").MorphTarget[]} targets Appended to.
 */
export function buildLookAt(ctx, plan, targets) {
  ctx.report.lookAt = plan.summary;
  if (plan.type === "none") return;
  const head = /** @type {number} */ (ctx.human.get("head"));
  const pivots = plan.parts.map((part) => part.pivot);
  const between = /** @type {Vec3} */ ([0, 1, 2].map((k) => (pivots[0][k] + pivots[1][k]) / 2));
  const scaleOut = plan.type === "bone" ? EYE_TURN_DEGREES : 1;
  const range = () => ({ inputMaxValue: RANGE_INPUT_DEGREES, outputScale: scaleOut });
  ctx.lookAt = {
    offsetFromHeadBone: sub(between, ctx.bonePos[head]).map((v) => Math.round(v * 1e5) / 1e5),
    type: plan.type,
    rangeMapHorizontalInner: range(),
    rangeMapHorizontalOuter: range(),
    rangeMapVerticalDown: range(),
    rangeMapVerticalUp: range(),
  };
  if (plan.type !== "expression") return;
  // A vertex in both eyes' parts (one mesh island for both) turns with the nearer eye only.
  const [a, b] = plan.parts;
  for (const v of [...a.vertices]) {
    if (!b.vertices.has(v)) continue;
    const p = /** @type {Vec3} */ ([ctx.positions[v * 3], ctx.positions[v * 3 + 1], ctx.positions[v * 3 + 2]]);
    if (length(sub(p, a.pivot)) <= length(sub(p, b.pivot))) b.vertices.delete(v);
    else a.vertices.delete(v);
  }
  const used = new Set(targets.map((t) => t.name));
  const angle = (EYE_TURN_DEGREES * Math.PI) / 180;
  /** @type {Record<string, [Vec3, number]>} The model faces +Z: its left is +X, up is +Y. */
  const turns = {
    lookLeft: [[0, 1, 0], angle],
    lookRight: [[0, 1, 0], -angle],
    lookUp: [[1, 0, 0], -angle],
    lookDown: [[1, 0, 0], angle],
  };
  /** @type {Record<string, number>} */
  const presets = {};
  for (const [name, [axis, a]] of Object.entries(turns)) {
    const q = /** @type {import("./math.mjs").Quat} */ ([axis[0] * Math.sin(a / 2), axis[1] * Math.sin(a / 2), axis[2] * Math.sin(a / 2), Math.cos(a / 2)]);
    /** @type {[number, Vec3][]} */
    const moved = [];
    for (const part of plan.parts)
      for (const v of part.vertices) {
        const p = /** @type {Vec3} */ ([ctx.positions[v * 3], ctx.positions[v * 3 + 1], ctx.positions[v * 3 + 2]]);
        const d = sub(p, part.pivot);
        const r = rotate(q, d);
        moved.push([v, sub(r, d)]);
      }
    moved.sort((x, y) => x[0] - y[0]);
    const offsets = new Float32Array(moved.length * 3);
    moved.forEach(([, o], i) => offsets.set(o, i * 3));
    presets[name] = targets.length;
    targets.push({ name: uniqueName(name, used), source: -1, vertices: Uint32Array.from(moved, ([v]) => v), offsets });
  }
  ctx.lookAtTargets = presets;
}

// ─── Finding the eyes ─────────────────────────────────────────────────────────

/**
 * Per vertex: its triangle-connected component, the vertices of each
 * component, and the vertices each bone skins.
 * @param {import("./context.mjs").Context} ctx
 */
function meshIndex(ctx) {
  const n = ctx.positions.length / 3;
  const root = new Int32Array(n).map((_, i) => i);
  const find = (v) => {
    while (root[v] !== v) {
      root[v] = root[root[v]];
      v = root[v];
    }
    return v;
  };
  const { indices } = ctx.model;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = find(indices[i]);
    for (const other of [indices[i + 1], indices[i + 2]]) {
      const b = find(other);
      if (a !== b) root[b] = a;
    }
  }
  const component = new Int32Array(n);
  /** @type {Map<number, number[]>} */
  const members = new Map();
  for (let v = 0; v < n; v++) {
    const c = find(v);
    component[v] = c;
    const list = members.get(c);
    if (list) list.push(v);
    else members.set(c, [v]);
  }
  /** @type {Map<number, number[]>} */
  const skinned = new Map();
  for (let v = 0; v < n; v++)
    for (let s = 0; s < 4; s++) {
      if (!(ctx.weights[v * 4 + s] > 0)) continue;
      const bone = ctx.joints[v * 4 + s];
      const list = skinned.get(bone);
      if (list) list.push(v);
      else skinned.set(bone, [v]);
    }
  return { component, members, skinned };
}

/** @returns {{min: Vec3, max: Vec3}} */
function bounds(ctx, vertices) {
  const min = /** @type {Vec3} */ ([Infinity, Infinity, Infinity]);
  const max = /** @type {Vec3} */ ([-Infinity, -Infinity, -Infinity]);
  for (const v of vertices)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], ctx.positions[v * 3 + k]);
      max[k] = Math.max(max[k], ctx.positions[v * 3 + k]);
    }
  return { min, max };
}

const diagonal = (b) => (Number.isFinite(b.min[0]) ? length(sub(b.max, b.min)) : 0);

/** Bounds grown by a quarter of their largest size and 3 mm, for "within the eye". */
function padded(b) {
  const pad = Math.max(...[0, 1, 2].map((k) => b.max[k] - b.min[k])) * 0.25 + 0.003;
  return { min: /** @type {Vec3} */ (b.min.map((v) => v - pad)), max: /** @type {Vec3} */ (b.max.map((v) => v + pad)) };
}

const inside = (b, p) => p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2];

/** A bone and every bone below it. */
function subtree(ctx, bone) {
  const out = new Set([bone]);
  const queue = [bone];
  for (let i = 0; i < queue.length; i++)
    for (const c of ctx.children[queue[i]])
      if (!out.has(c)) {
        out.add(c);
        queue.push(c);
      }
  return out;
}

function ancestors(ctx, bone) {
  const out = new Set();
  for (let p = ctx.parent[bone]; p >= 0 && !out.has(p); p = ctx.parent[p]) out.add(p);
  return out;
}

/**
 * The eye part an eye bone carries, and the bones beside the eye it needs.
 * The part is every mesh island where the eye bone (or a bone below it)
 * carries half a vertex's weight or more, or only those vertices when the
 * island is much larger (a face mesh). A bone that is not the eye's, nor above
 * it, but skins part of it (a separate pupil or highlight bone) can be moved
 * under the eye when it hangs from the head (or above), sits within the eye
 * and skins nothing outside the part; otherwise it is stuck, with the reason.
 * @param {import("./context.mjs").Context} ctx
 * @param {ReturnType<typeof meshIndex>} mesh
 * @param {"left" | "right"} side
 * @param {number} eye
 * @param {number} otherEye An island that the other eye also skins is never taken whole.
 * @returns {{part: EyePart | null, adopted: number[], stuck: {bone: number, reason: string}[], stretch: number}}
 */
function eyeBonePart(ctx, mesh, side, eye, otherEye) {
  const own = subtree(ctx, eye);
  const above = ancestors(ctx, eye);
  const shared = new Set();
  for (const bone of subtree(ctx, otherEye)) if (!own.has(bone)) for (const v of mesh.skinned.get(bone) ?? []) shared.add(mesh.component[v]);
  /** @type {Map<number, number[]>} Per island, the vertices the eye carries at least half of. */
  const seeds = new Map();
  /** @type {Set<number>} */
  const seen = new Set();
  for (const bone of own)
    for (const v of mesh.skinned.get(bone) ?? []) {
      if (seen.has(v)) continue;
      seen.add(v);
      let carried = 0;
      for (let s = 0; s < 4; s++) if (own.has(ctx.joints[v * 4 + s])) carried += Math.max(0, ctx.weights[v * 4 + s]);
      // A lash or lid that follows the gaze only a little is not part of the eye.
      if (carried < 0.5 - 1e-6) continue;
      const c = mesh.component[v];
      const list = seeds.get(c);
      if (list) list.push(v);
      else seeds.set(c, [v]);
    }
  if (seeds.size === 0) return { part: null, adopted: [], stuck: [], stretch: 0 };
  const vertices = new Set();
  for (const [c, seeded] of seeds) {
    const island = /** @type {number[]} */ (mesh.members.get(c));
    const whole = !shared.has(c) && diagonal(bounds(ctx, island)) <= Math.max(2 * diagonal(bounds(ctx, seeded)), 0.005);
    for (const v of whole ? island : seeded) vertices.add(v);
  }
  // Within the eye: its part and its bone (a pupil bone may sit at the eyeball's centre).
  const extent = bounds(ctx, vertices);
  for (let k = 0; k < 3; k++) {
    extent.min[k] = Math.min(extent.min[k], ctx.bonePos[eye][k]);
    extent.max[k] = Math.max(extent.max[k], ctx.bonePos[eye][k]);
  }
  const area = padded(extent);

  const humanBones = new Set(ctx.human.values());
  /** Why a bone may not move under the eye, or null when it may. */
  const blocker = (bone) => {
    const parent = ctx.parent[bone];
    // Moving it would cut it off a parent that a bone morph or animation may move.
    if (parent >= 0 && !above.has(parent)) return `hangs from '${ctx.model.bones[parent].name}', which is not above the eye bone`;
    if (!inside(area, ctx.bonePos[bone])) return "sits outside the eye";
    for (const b of subtree(ctx, bone)) {
      if (ctx.simulated[b] || humanBones.has(b)) return "is a humanoid or physics bone";
      for (const v of mesh.skinned.get(b) ?? []) if (!vertices.has(v)) return "also moves other parts of the model";
    }
    return null;
  };
  const foreign = new Set();
  for (const v of vertices)
    for (let s = 0; s < 4; s++) {
      const bone = ctx.joints[v * 4 + s];
      if (ctx.weights[v * 4 + s] > 0 && !own.has(bone) && !above.has(bone)) foreign.add(bone);
    }
  // Keep only the topmost of nested foreign bones: moving it brings the rest.
  const topmost = (set) => [...set].filter((b) => ![...ancestors(ctx, b)].some((a) => set.has(a)));
  const stuck = topmost(foreign).flatMap((bone) => {
    const reason = blocker(bone);
    return reason ? [{ bone, reason }] : [];
  });
  const adopted = topmost(foreign).filter((bone) => !blocker(bone));
  // Vertices also skinned to the head (or above): they stretch as the eye turns.
  const carried = new Set([...own, ...adopted.flatMap((b) => [...subtree(ctx, b)])]);
  let stretch = 0;
  for (const v of vertices)
    for (let s = 0; s < 4; s++)
      if (ctx.weights[v * 4 + s] > 0 && !carried.has(ctx.joints[v * 4 + s])) {
        stretch += 1;
        break;
      }
  return { part: { side, eye, vertices, pivot: ctx.bonePos[eye] }, adopted, stuck, stretch };
}

/**
 * Eye parts by material name, for models whose eye bones carry nothing:
 * the vertices of eye materials (瞳, iris …), split at the head's centre.
 * Each turns about a point behind it (see below).
 * @returns {EyePart[]}
 */
function materialParts(ctx, mesh, head) {
  const { model } = ctx;
  const centreX = ctx.bonePos[head][0];
  /** @type {Record<"left" | "right", Set<number>>} */
  const sides = { left: new Set(), right: new Set() };
  let offset = 0;
  for (const material of model.materials) {
    const range = [offset, offset + material.indexCount];
    offset += material.indexCount;
    const names = [material.name, material.nameEn].filter(Boolean);
    if (!names.some((name) => EYE_MATERIAL.test(name)) || names.some((name) => NOT_EYE_MATERIAL.test(name))) continue;
    for (let i = range[0]; i < range[1]; i++) {
      const v = model.indices[i];
      if (ctx.positions[v * 3 + 1] < ctx.bonePos[head][1] - 0.05) continue; // below the head: not an eye
      sides[ctx.positions[v * 3] >= centreX ? "left" : "right"].add(v);
    }
  }
  void mesh;
  if (sides.left.size === 0 || sides.right.size === 0) return [];
  return /** @type {const} */ (["left", "right"]).map((side) => {
    const b = bounds(ctx, sides[side]);
    const centre = /** @type {Vec3} */ ([0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2));
    // A flat iris turns about a point one eye-width behind its front; an eyeball, about its centre.
    const width = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
    const ball = b.max[2] - b.min[2] >= 0.5 * width;
    return { side, eye: -1, vertices: sides[side], pivot: [centre[0], centre[1], ball ? centre[2] : b.max[2] - width] };
  });
}

/**
 * Move a bone under another, keeping where it is: bone nodes carry only
 * translations, written from the bones' positions, so only the hierarchy changes.
 */
function reparent(ctx, bone, parent) {
  const old = ctx.parent[bone];
  if (old === parent) return;
  if (old >= 0) ctx.children[old] = ctx.children[old].filter((c) => c !== bone);
  ctx.parent[bone] = parent;
  ctx.children[parent].push(bone);
  const queue = [];
  for (let i = 0; i < ctx.boneCount; i++) if (ctx.parent[i] < 0) queue.push(i);
  for (let h = 0; h < queue.length; h++) queue.push(...ctx.children[queue[h]]);
  ctx.order = queue;
}
