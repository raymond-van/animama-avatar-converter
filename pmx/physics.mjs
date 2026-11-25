import { drop } from "./context.mjs";
import { humanBoneAliases, isDescendant } from "./humanoid.mjs";
import { add, dot, eulerYXZAxes, length, normalize, rotate, scale, sub } from "./math.mjs";
import { uniqueName } from "./names.mjs";

/**
 * MMD rigid bodies in glTF space, and the springs and colliders made from
 * them. Ported from pmx-to-vrm's `Physics` (MIT).
 */

/**
 * @typedef {import("./math.mjs").Vec3} Vec3
 *
 * @typedef {object} Body
 * @property {number} index
 * @property {number} bone -1 when the body has no usable bone.
 * @property {number} shape 0 sphere, 1 box, 2 capsule.
 * @property {number} mode 0 follows its bone, 1 physics, 2 physics with the bone's position.
 * @property {Vec3} center
 * @property {Vec3} axisX
 * @property {Vec3} axisY
 * @property {Vec3} axisZ
 * @property {Vec3} size Scaled: sphere x radius; box half extents; capsule x radius, y cylinder height.
 * @property {number} group
 * @property {number} mask
 * @property {number} mass
 * @property {number} linearDamping
 * @property {number} angularDamping
 * @property {string} name
 */

/**
 * The model's rigid bodies, moved into glTF space (metres, Z mirrored).
 * @param {import("./reader.mjs").PmxModel} model
 * @param {number} boneCount
 * @param {number} unit Metres per MMD unit.
 * @param {string[]} warnings
 * @returns {Body[]}
 */
export function setupBodies(model, boneCount, unit, warnings) {
  let unbound = 0;
  const bodies = model.rigidBodies.map((rb, index) => {
    // Built in MMD space, then mirrored with Z like every other position.
    const axes = eulerYXZAxes(rb.rotation).map((axis) => normalize([axis[0], axis[1], -axis[2]]));
    const bone = rb.bone >= 0 && rb.bone < boneCount ? rb.bone : -1;
    if (bone < 0) unbound += 1;
    return {
      index,
      bone,
      shape: rb.shape,
      mode: rb.mode,
      center: /** @type {Vec3} */ ([rb.position[0] * unit, rb.position[1] * unit, -rb.position[2] * unit]),
      axisX: axes[0],
      axisY: axes[1],
      axisZ: axes[2],
      size: /** @type {Vec3} */ (rb.size.map((v) => Math.abs(v) * unit)),
      group: rb.group & 15,
      mask: rb.collisionMask,
      mass: rb.mass,
      linearDamping: rb.linearDamping,
      angularDamping: rb.angularDamping,
      name: rb.name,
    };
  });
  if (unbound > 0) warnings.push(`${unbound} rigid bodies have no bone and were ignored.`);
  return bodies;
}

/**
 * MMD physics as VRMC_springBone: simulated rigid bodies become spring joints
 * along their bone chains, bodies that follow their bones become colliders,
 * and the collision groups and masks choose which colliders each spring
 * hits. Ported from pmx-to-vrm's `Physics` (MIT).
 */

const MODE_FOLLOW_BONE = 0;
const SHAPE_SPHERE = 0;
const SHAPE_CAPSULE = 2;

/** Whether two bodies collide in MMD: each one's mask has the other's group. */
const collides = (a, b) => (a.mask & (1 << b.group)) !== 0 && (b.mask & (1 << a.group)) !== 0;

/**
 * Write `ctx.springBone`, the tail nodes in `ctx.extraNodes`, and the report's
 * spring lines. Call after the rest-pose bake and grounding, so bodies and
 * bones are where the VRM has them, and before the mesh node is numbered.
 * @param {import("./context.mjs").Context} ctx
 */
export function buildSprings(ctx) {
  const { model, report } = ctx;
  const n = ctx.boneCount;
  /** @type {Map<number, string>} */
  const humanOf = new Map([...ctx.human].map(([name, bone]) => [bone, name]));
  const aliases = humanBoneAliases(model, ctx.human);
  /** @type {Map<number, Body>} The simulated body on each bone (the first, when several share one). */
  const bodyOfBone = new Map();
  for (const body of ctx.bodies) if (body.bone >= 0 && body.mode !== MODE_FOLLOW_BONE && !bodyOfBone.has(body.bone)) bodyOfBone.set(body.bone, body);

  const simulatedBelow = new Array(n).fill(false);
  for (let i = 0; i < n; i++) if (ctx.simulated[i]) for (let p = ctx.parent[i]; p >= 0 && !simulatedBelow[p]; p = ctx.parent[p]) simulatedBelow[p] = true;
  // 下半身 holds the skirt but also the legs: a bone with humanoid bones below it is body, not a chain's anchor.
  const humanBelow = new Array(n).fill(false);
  for (const bone of humanOf.keys()) for (let p = ctx.parent[bone]; p >= 0 && !humanBelow[p]; p = ctx.parent[p]) humanBelow[p] = true;
  const underSimulated = (bone) => {
    for (let p = ctx.parent[bone]; p >= 0; p = ctx.parent[p]) if (ctx.simulated[p]) return true;
    return false;
  };
  const nearestHuman = (bone) => {
    for (let b = bone; b >= 0; b = ctx.parent[b]) if (humanOf.has(b)) return humanOf.get(b);
    return null;
  };

  // ── Colliders, grouped by MMD collision group (and mask, where a group's bodies differ).
  /** @type {{node: number, shape: object}[]} */
  const colliders = [];
  /** @type {{body: Body, group: number}[]} */
  const colliderBodies = [];
  /** @type {{name: string, colliders: number[]}[]} */
  const groups = [];
  /** @type {Map<string, number>} */
  const groupIndex = new Map();
  /** @type {Map<number, number>} Collider groups made so far per MMD group (one per mask). */
  const masksSeen = new Map();
  let anchors = 0;
  let moved = 0;
  for (const body of ctx.bodies) {
    // A body whose bone follows the animation: one set to follow its bone, or physics left off a humanoid bone.
    if (body.bone < 0 || ctx.simulated[body.bone] || underSimulated(body.bone)) continue;
    let node = body.bone;
    if (aliases.has(body.bone)) {
      // A body on 左足 while the humanoid uses 左足D: hang the collider on the bone that moves.
      node = /** @type {number} */ (ctx.human.get(/** @type {string} */ (aliases.get(body.bone))));
      moved += 1;
    } else if (!humanOf.has(body.bone) && simulatedBelow[body.bone] && !humanBelow[body.bone]) {
      // The anchor of a chain (a skirt or hair root) holds the chain; it is not something to hit.
      anchors += 1;
      continue;
    }
    const key = `${body.group}:${body.mask}`;
    if (!groupIndex.has(key)) {
      const sameGroup = masksSeen.get(body.group) ?? 0;
      masksSeen.set(body.group, sameGroup + 1);
      groupIndex.set(key, groups.length);
      groups.push({ name: `MMD group ${body.group + 1}${sameGroup > 0 ? ` (${sameGroup + 1})` : ""}`, colliders: [] });
    }
    const group = /** @type {number} */ (groupIndex.get(key));
    groups[group].colliders.push(colliders.length);
    colliders.push({ node, shape: colliderShape(body, ctx.bonePos[node]) });
    colliderBodies.push({ body, group });
  }

  // ── Chains: a simulated bone whose parent is not simulated starts one; at a
  // branch the deepest child continues it and each other child starts its own.
  /** @type {number[][]} */
  const chains = [];
  const depth = new Array(n).fill(0);
  for (const b of [...ctx.order].reverse())
    if (ctx.simulated[b]) depth[b] = 1 + Math.max(0, ...ctx.children[b].filter((c) => ctx.simulated[c]).map((c) => depth[c]));
  const starts = [];
  for (const b of ctx.order) if (ctx.simulated[b] && (ctx.parent[b] < 0 || !ctx.simulated[ctx.parent[b]])) starts.push(b);
  for (let head = 0; head < starts.length; head++) {
    let current = starts[head];
    const chain = [current];
    for (;;) {
      const kids = ctx.children[current].filter((c) => ctx.simulated[c]).sort((a, b) => depth[b] - depth[a] || a - b);
      if (kids.length === 0) break;
      starts.push(...kids.slice(1));
      current = kids[0];
      chain.push(current);
    }
    chains.push(chain);
  }
  // Colliders alone move nothing.
  if (chains.length === 0) return;

  const usedNames = new Set(ctx.nodeNames);
  /** @type {number[]} The chain each bone's spring is, -1 for none. */
  const chainOf = new Array(n).fill(-1);
  chains.forEach((chain, c) => chain.forEach((bone) => (chainOf[bone] = c)));
  const springs = [];
  let jointCount = 0;
  /** @type {Map<string, number>} Chains per nearest human bone, for the report. */
  const chainsUnder = new Map();
  /** @type {string[]} */
  const inside = [];
  for (const chain of chains) {
    const last = chain[chain.length - 1];
    const tail = tailNode(ctx, last, usedNames);
    const nodes = [...chain, tail];
    /** @type {Body[]} */
    const chainBodies = chain.flatMap((bone) => (bodyOfBone.has(bone) ? [/** @type {Body} */ (bodyOfBone.get(bone))] : []));
    /** @type {Record<string, unknown> | null} */
    let previous = null;
    const joints = nodes.map((node, j) => {
      const body = j < chain.length ? bodyOfBone.get(chain[j]) : undefined;
      const params = body ? jointParams(model, body) : previous ? { ...previous } : defaultJoint();
      previous = params;
      return { node, ...params };
    });
    jointCount += joints.length;
    const useGroups = [...new Set(colliderBodies.filter(({ body }) => chainBodies.some((b) => collides(b, body))).map(({ group }) => group))].sort((a, b) => a - b);
    /** @type {Record<string, unknown>} */
    const spring = { name: ctx.nodeNames[chain[0]], joints };
    if (useGroups.length > 0) spring.colliderGroups = useGroups;
    springs.push(spring);
    const under = nearestHuman(chain[0]) ?? "root";
    chainsUnder.set(under, (chainsUnder.get(under) ?? 0) + 1);
    const hitting = colliderBodies.filter(({ group }) => useGroups.includes(group)).map(({ body }) => body);
    const count = jointsInside(ctx, nodes, joints, hitting);
    if (count > 0) inside.push(`${ctx.nodeNames[chain[0]]} (${count})`);
  }

  // PMX joints that tie two chains together sideways (skirt rings): VRM springs only hang.
  let across = 0;
  for (const joint of model.joints) {
    const a = ctx.bodies[joint.bodyA];
    const b = ctx.bodies[joint.bodyB];
    if (!a || !b || a.bone < 0 || b.bone < 0) continue;
    const [ca, cb] = [chainOf[a.bone], chainOf[b.bone]];
    if (ca < 0 || cb < 0 || ca === cb) continue;
    // A branch hanging from its parent chain, or a strand with a bone without physics in between, still hangs.
    if (isDescendant(ctx.parent, a.bone, b.bone) || isDescendant(ctx.parent, b.bone, a.bone)) continue;
    across += 1;
  }
  drop(ctx, "physics joints between neighbouring chains (VRM springs only hang)", across);

  ctx.springBone = { specVersion: "1.0", colliders, colliderGroups: groups, springs };
  const under = [...chainsUnder].sort((a, b) => b[1] - a[1]).map(([bone, count]) => `${count} under ${bone}`);
  report.springs = [
    `Springs: ${chains.length} chains with ${jointCount} joints (${under.join(", ") || "none"}); ${colliders.length} colliders in ${groups.length} groups.`,
  ];
  if (moved > 0) report.notes.push(`${moved} collider bodies sat on leg bones the humanoid does not use (足 beside 足D); moved onto the bones that move.`);
  if (anchors > 0) report.notes.push(`${anchors} bodies that hold a chain's root (on non-humanoid bones) were not made colliders.`);
  if (inside.length > 0)
    report.warnings.push(`Spring joints that start inside a collider they hit, and may push out at rest: ${inside.slice(0, 5).join(", ")}${inside.length > 5 ? ` and ${inside.length - 5} more chains` : ""}.`);
}

/**
 * The node after a chain's last bone: a child bone if it has one, else a new
 * leaf node where the bone's tail points.
 * @param {import("./context.mjs").Context} ctx
 * @param {number} last
 * @param {Set<string>} usedNames
 * @returns {number}
 */
function tailNode(ctx, last, usedNames) {
  const bone = ctx.model.bones[last];
  const kids = ctx.children[last];
  const TAIL_IS_BONE = 0x0001;
  if (bone.flags & TAIL_IS_BONE && kids.includes(bone.tailBone)) return bone.tailBone;
  if (kids.length > 0) return kids.reduce((best, k) => (length(sub(ctx.bonePos[k], ctx.bonePos[last])) > length(sub(ctx.bonePos[best], ctx.bonePos[last])) ? k : best));
  /** @type {Vec3} */
  let offset;
  if (bone.flags & TAIL_IS_BONE && bone.tailBone >= 0 && bone.tailBone < ctx.boneCount && bone.tailBone !== last) offset = sub(ctx.bonePos[bone.tailBone], ctx.bonePos[last]);
  else offset = rotate(ctx.bakeRotation[last], [bone.tailOffset[0] * ctx.unit, bone.tailOffset[1] * ctx.unit, -bone.tailOffset[2] * ctx.unit]);
  if (!(length(offset) > 1e-4)) {
    const parent = ctx.parent[last];
    const along = parent >= 0 ? sub(ctx.bonePos[last], ctx.bonePos[parent]) : [0, -0.05, 0];
    offset = length(along) > 1e-4 ? scale(along, 0.7) : [0, -0.05, 0];
    if (length(offset) < 0.01) offset = scale(offset, 0.03 / length(offset));
  }
  ctx.extraNodes.push({ name: uniqueName(`${ctx.nodeNames[last]}_end`, usedNames), parent: last, position: add(ctx.bonePos[last], offset) });
  return ctx.boneCount + ctx.extraNodes.length - 1;
}

const defaultJoint = () => ({ hitRadius: 0.02, stiffness: 1, gravityPower: 0.1, gravityDir: [0, -1, 0], dragForce: 0.4 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0.5);
const round = (v) => Math.round(v * 1e4) / 1e4;

/**
 * Spring settings from a simulated body and the PMX joint that holds it:
 * looser joints and softer springs bend more, damping drags, mass pulls down,
 * and the body's thickness is the hit radius. pmx-to-vrm's formulas.
 * @param {import("./reader.mjs").PmxModel} model
 * @param {Body} body
 */
function jointParams(model, body) {
  const joint = model.joints.find((j) => j.bodyB === body.index) ?? model.joints.find((j) => j.bodyA === body.index);
  let range = 1;
  let spring = 0;
  if (joint) {
    const span = [0, 1, 2].map((k) => joint.rotationMax[k] - joint.rotationMin[k]);
    range = (Math.abs(span[0]) + Math.abs(span[1]) + Math.abs(span[2])) / 3;
    range = Number.isFinite(range) ? clamp(range, 0, 2 * Math.PI) : 1;
    const s = joint.rotationSpring;
    spring = (Math.abs(s[0]) + Math.abs(s[1]) + Math.abs(s[2])) / 3;
    if (!Number.isFinite(spring)) spring = 0;
  }
  const stiffness = clamp(0.6 / Math.max(range, 0.15) + spring / 40, 0.4, 4);
  const drag = clamp(((clamp01(body.linearDamping) + clamp01(body.angularDamping)) / 2) * 0.8, 0.2, 0.9);
  const mass = Number.isFinite(body.mass) ? Math.max(0, body.mass) : 1;
  const gravity = clamp(0.05 + 0.1 * Math.min(mass, 2), 0, 0.3);
  const radius = clamp(bodyRadius(body), 0.005, 0.12);
  return { hitRadius: round(radius), stiffness: round(stiffness), gravityPower: round(gravity), gravityDir: [0, -1, 0], dragForce: round(drag) };
}

/** A body's thickness: the sphere or capsule radius, or a box's two smaller half extents averaged. */
function bodyRadius(body) {
  if (body.shape === SHAPE_SPHERE || body.shape === SHAPE_CAPSULE) return body.size[0];
  const [a, b] = [...body.size].sort((x, y) => x - y);
  return (a + b) / 2;
}

/**
 * A body as a sphere or a capsule in glTF space. A box becomes a capsule along
 * its longest axis, as thick as its other two half extents averaged.
 * @param {Body} body
 * @returns {{sphere: boolean, a: Vec3, b: Vec3, radius: number}}
 */
export function bodyShape(body) {
  if (body.shape === SHAPE_SPHERE) return { sphere: true, a: body.center, b: body.center, radius: body.size[0] };
  if (body.shape === SHAPE_CAPSULE) {
    const half = scale(body.axisY, body.size[1] / 2);
    return length(half) < 1e-5 ? { sphere: true, a: body.center, b: body.center, radius: body.size[0] } : { sphere: false, a: sub(body.center, half), b: add(body.center, half), radius: body.size[0] };
  }
  const extents = [
    [body.size[0], body.axisX],
    [body.size[1], body.axisY],
    [body.size[2], body.axisZ],
  ].sort((x, y) => /** @type {number} */ (y[0]) - /** @type {number} */ (x[0]));
  const radius = (/** @type {number} */ (extents[1][0]) + /** @type {number} */ (extents[2][0])) / 2;
  const reach = /** @type {number} */ (extents[0][0]) - radius;
  if (reach < 0.001) return { sphere: true, a: body.center, b: body.center, radius: (body.size[0] + body.size[1] + body.size[2]) / 3 };
  const half = scale(/** @type {Vec3} */ (extents[0][1]), reach);
  return { sphere: false, a: sub(body.center, half), b: add(body.center, half), radius };
}

/** The collider shape in its node's space (bone nodes carry no rotation). */
function colliderShape(body, origin) {
  const { sphere, a, b, radius } = bodyShape(body);
  const r = round(radius);
  return sphere ? { sphere: { offset: sub(a, origin).map(round), radius: r } } : { capsule: { offset: sub(a, origin).map(round), radius: r, tail: sub(b, origin).map(round) } };
}

/** How many of a chain's joints after the first start inside a collider the chain hits. */
function jointsInside(ctx, nodes, joints, bodies) {
  let count = 0;
  for (let j = 1; j < nodes.length; j++) {
    const node = nodes[j];
    const p = node < ctx.boneCount ? ctx.bonePos[node] : ctx.extraNodes[node - ctx.boneCount].position;
    const hit = joints[j].hitRadius;
    if (bodies.some((body) => distanceTo(p, bodyShape(body)) < bodyShape(body).radius + hit * 0.5)) count += 1;
  }
  return count;
}

function distanceTo(p, { a, b }) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return length(sub(p, add(a, scale(ab, t))));
}

