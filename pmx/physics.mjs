import { eulerYXZAxes, normalize } from "./math.mjs";

/**
 * MMD rigid bodies in glTF space. Ported from pmx-to-vrm's `Physics` (MIT).
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
