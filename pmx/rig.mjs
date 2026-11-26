import { humanBoneAliases } from "./humanoid.mjs";
import { length, sub } from "./math.mjs";

/**
 * Changes to the bone hierarchy that keep each bone where it is: bone nodes
 * carry only translations, written from the bones' positions, so moving a
 * bone under another changes only what it follows.
 */

/**
 * Move a bone under another, keeping where it is.
 * @param {import("./context.mjs").Context} ctx
 * @param {number} bone
 * @param {number} parent
 */
export function reparent(ctx, bone, parent) {
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

/** How close (metres) a bone must sit to a joint to count as on it. */
const ON_JOINT = 1e-3;

/**
 * Bones that MMD makes follow another bone through a one-link IK: a sleeve
 * chain beside the arm, each sleeve bone turned by an IK bone that rides on
 * the arm. VRM has no IK, so such a bone would keep its rest direction while
 * the arm moves. Where the IK bone rides on a body bone (a humanoid bone or one
 * below it; not an IK handle, an unused leg bone or a physics bone) that sits
 * on the same joint as the IK's link
 * (左腕袖 on 左腕's joint, its IK under 左腕捩), the link is moved under that
 * bone, which then carries it as the IK would. Call before the rest-pose
 * bake, so the moved bones straighten with the arm.
 * @param {import("./context.mjs").Context} ctx
 */
export function followIkChains(ctx) {
  const { bones } = ctx.model;
  const human = new Set(ctx.human.values());
  // MMD's plain leg chain beside the D-bones (足, ひざ, 足首) never moves in a VRM.
  const still = new Set(humanBoneAliases(ctx.model, ctx.human).keys());
  /**
   * Whether a bone moves with the body: a humanoid bone or one below it, and
   * not an IK handle, a leg bone the humanoid does not use, or a physics bone.
   */
  const onBody = (bone) => {
    if (bones[bone].ik || ctx.simulated[bone]) return false;
    for (let b = bone; b >= 0; b = ctx.parent[b]) {
      if (still.has(b) || (b !== bone && ctx.simulated[b])) return false;
      if (human.has(b)) return true;
    }
    return false;
  };
  const moved = [];
  bones.forEach((bone, ik) => {
    if (bone.ik?.links.length !== 1) return;
    const link = bone.ik.links[0].bone;
    if (link < 0 || link >= ctx.boneCount || link === ik || human.has(link) || ctx.simulated[link]) return;
    const below = new Set([link]);
    for (let i = 0; i < ctx.order.length; i++) {
      const b = ctx.order[i];
      if (ctx.parent[b] >= 0 && below.has(ctx.parent[b])) below.add(b);
    }
    if (below.has(ik)) return;
    // The IK bone's nearest ancestor on the link's joint carries the link.
    for (let a = ctx.parent[ik]; a >= 0; a = ctx.parent[a]) {
      if (below.has(a)) return;
      if (length(sub(ctx.bonePos[a], ctx.bonePos[link])) > ON_JOINT) continue;
      if (!onBody(a)) return;
      if (a !== ctx.parent[link]) {
        reparent(ctx, link, a);
        moved.push(link);
      }
      return;
    }
  });
  if (moved.length > 0)
    ctx.report.notes.push(
      `Bones that MMD turns with an IK to follow another (sleeves and the like) now hang from the bones they follow (${moved.length}): ${moved
        .slice(0, 4)
        .map((b) => `'${bones[b].name}'`)
        .join(", ")}${moved.length > 4 ? " …" : ""}.`,
    );
}
