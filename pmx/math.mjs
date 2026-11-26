/**
 * Small vector and quaternion helpers. Vectors are [x, y, z] arrays and
 * quaternions [x, y, z, w], so they serialise straight into glTF JSON.
 */

/** @typedef {[number, number, number]} Vec3 */
/** @typedef {[number, number, number, number]} Quat */

/** @returns {Vec3} */
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @returns {Vec3} */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @returns {Vec3} */
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @returns {Vec3} */
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);

/** @returns {Vec3} */
export function normalize(a, fallback = /** @type {Vec3} */ ([0, 1, 0])) {
  const n = length(a);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [...fallback];
}

/** @returns {Quat} */
export function quatNormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n > 0 ? [q[0] / n, q[1] / n, q[2] / n, q[3] / n] : [0, 0, 0, 1];
}

/**
 * a × b: apply b, then a.
 * @returns {Quat}
 */
export function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * Rotate a vector by a unit quaternion.
 * @returns {Vec3}
 */
export function rotate(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/**
 * The shortest rotation taking unit vector a onto unit vector b.
 * @returns {Quat}
 */
export function fromTo(a, b) {
  const d = dot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    let axis = cross([0, 1, 0], a);
    if (dot(axis, axis) < 1e-6) axis = cross([0, 0, 1], a);
    axis = normalize(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(a, b);
  return quatNormalize([c[0], c[1], c[2], 1 + d]);
}

/** The rotation angle of a unit quaternion, in degrees. */
export function angleDegrees(q) {
  return (2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180) / Math.PI;
}

/**
 * Rotation matrix columns for Euler angles applied Y, then X, then Z (three's
 * 'YXZ' order, as MMD's Bullet uses for rigid bodies): R = Ry · Rx · Rz.
 * Returns the images of the unit X, Y and Z axes.
 * @param {Vec3} euler
 * @returns {[Vec3, Vec3, Vec3]}
 */
export function eulerYXZAxes(euler) {
  const [x, y, z] = euler;
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  // Columns of Ry·Rx·Rz.
  return [
    [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz],
    [-cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz],
    [sy * cx, -sx, cy * cx],
  ];
}

/** A finite number, or 0. glTF JSON has no NaN or infinity. */
export function finite(value) {
  return Number.isFinite(value) ? value : 0;
}

/** A float rounded for JSON (six decimals, never -0). */
export function num(value) {
  const rounded = Math.round(finite(value) * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded;
}
