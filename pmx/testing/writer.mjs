import { BONE_FLAGS, MORPH_TYPES } from "../reader.mjs";

/**
 * A test-only PMX 2.0/2.1 writer for models in the shape `readPmx` returns.
 * Adapted from pmx-to-vrm's test `PmxWriter` (MIT). It exists so tests can
 * build synthetic models; it is not shipped.
 */

/**
 * @param {import("../reader.mjs").PmxModel} model
 * @param {{encoding?: 0 | 1, vertexSize?: 1 | 2 | 4, indexSize?: 1 | 2 | 4, additionalUvs?: number}} [options]
 * @returns {Uint8Array}
 */
export function writePmx(model, options = {}) {
  const encoding = options.encoding ?? model.encoding ?? 0;
  const vertexSize = options.vertexSize ?? (model.vertexCount < 255 ? 1 : model.vertexCount < 65535 ? 2 : 4);
  const indexSize = options.indexSize ?? 2;
  const additionalUvs = options.additionalUvs ?? 0;
  const w = new Writer();
  w.bytes([0x50, 0x4d, 0x58, 0x20]);
  w.f32(model.version ?? 2);
  w.u8(8);
  w.bytes([encoding, additionalUvs, vertexSize, indexSize, indexSize, indexSize, indexSize, indexSize]);
  const text = (value) => {
    const bytes = encoding === 1 ? Buffer.from(value, "utf8") : Buffer.from(value, "utf16le");
    w.i32(bytes.length);
    w.bytes(bytes);
  };
  const index = (value) => w.index(value, indexSize);
  const vertexIndex = (value) => w.unsigned(value, vertexSize);

  text(model.name);
  text(model.nameEn);
  text(model.comment);
  text(model.commentEn);

  w.i32(model.vertexCount);
  for (let v = 0; v < model.vertexCount; v++) {
    for (let k = 0; k < 3; k++) w.f32(model.positions[v * 3 + k]);
    for (let k = 0; k < 3; k++) w.f32(model.normals[v * 3 + k]);
    w.f32(model.uvs[v * 2]);
    w.f32(model.uvs[v * 2 + 1]);
    for (let k = 0; k < additionalUvs * 4; k++) w.f32(k + 1);
    const type = model.weightTypes[v];
    w.u8(type);
    const bones = model.skinBones.subarray(v * 4, v * 4 + 4);
    const weights = model.skinWeights.subarray(v * 4, v * 4 + 4);
    if (type === 0) index(bones[0]);
    else if (type === 1 || type === 3) {
      index(bones[0]);
      index(bones[1]);
      w.f32(weights[0]);
      if (type === 3) for (let k = 0; k < 9; k++) w.f32(0);
    } else {
      for (let k = 0; k < 4; k++) index(bones[k]);
      for (let k = 0; k < 4; k++) w.f32(weights[k]);
    }
    w.f32(model.edgeScales[v]);
  }

  w.i32(model.indices.length);
  for (const i of model.indices) vertexIndex(i);

  w.i32(model.textures.length);
  for (const t of model.textures) text(t);

  w.i32(model.materials.length);
  for (const m of model.materials) {
    text(m.name);
    text(m.nameEn);
    w.vec(m.diffuse);
    w.vec(m.specular);
    w.f32(m.specularPower);
    w.vec(m.ambient);
    w.u8(m.flags);
    w.vec(m.edgeColor);
    w.f32(m.edgeSize);
    index(m.textureIndex);
    index(m.sphereIndex);
    w.u8(m.sphereMode);
    w.u8(m.sharedToon ? 1 : 0);
    if (m.sharedToon) w.u8(m.toonIndex);
    else index(m.toonIndex);
    text(m.memo);
    w.i32(m.indexCount);
  }

  w.i32(model.bones.length);
  for (const b of model.bones) {
    text(b.name);
    text(b.nameEn);
    w.vec(b.position);
    index(b.parent);
    w.i32(b.layer);
    w.u16(b.flags);
    if (b.flags & BONE_FLAGS.tailIsBone) index(b.tailBone);
    else w.vec(b.tailOffset);
    if (b.flags & (BONE_FLAGS.inheritRotation | BONE_FLAGS.inheritTranslation)) {
      index(b.inheritParent);
      w.f32(b.inheritWeight);
    }
    if (b.flags & BONE_FLAGS.fixedAxis) w.vec([0, -1, 0]);
    if (b.flags & BONE_FLAGS.localAxis) {
      w.vec([1, 0, 0]);
      w.vec([0, 0, 1]);
    }
    if (b.flags & BONE_FLAGS.externalParent) w.i32(0);
    if (b.flags & BONE_FLAGS.ik && b.ik) {
      index(b.ik.target);
      w.i32(b.ik.loops);
      w.f32(b.ik.limitAngle);
      w.i32(b.ik.links.length);
      for (const link of b.ik.links) {
        index(link.bone);
        w.u8(link.hasLimits ? 1 : 0);
        if (link.hasLimits) {
          w.vec(link.min);
          w.vec(link.max);
        }
      }
    }
  }

  w.i32(model.morphs.length);
  for (const m of model.morphs) {
    text(m.name);
    text(m.nameEn);
    w.u8(m.panel);
    w.u8(m.type);
    switch (m.type) {
      case MORPH_TYPES.group:
      case MORPH_TYPES.flip:
        w.i32(m.group.length);
        for (const g of m.group) {
          index(g.morph);
          w.f32(g.weight);
        }
        break;
      case MORPH_TYPES.vertex:
        w.i32(m.vertex.length);
        for (const p of m.vertex) {
          vertexIndex(p.vertex);
          w.vec(p.offset);
        }
        break;
      case MORPH_TYPES.bone:
        w.i32(m.bone.length);
        for (const p of m.bone) {
          index(p.bone);
          w.vec(p.translation);
          w.vec(p.rotation);
        }
        break;
      case MORPH_TYPES.material:
        w.i32(m.material.length);
        for (const p of m.material) {
          index(p.material);
          w.u8(p.operation);
          w.vec(p.diffuse);
          w.vec(p.specular);
          w.f32(p.specularPower);
          w.vec(p.ambient);
          w.vec(p.edgeColor);
          w.f32(p.edgeSize);
          w.vec(p.textureTint);
          w.vec(p.sphereTint);
          w.vec(p.toonTint);
        }
        break;
      case MORPH_TYPES.impulse:
        w.i32(0);
        break;
      default:
        w.i32(m.uv.length);
        for (const p of m.uv) {
          vertexIndex(p.vertex);
          w.vec(p.offset);
        }
    }
  }

  w.i32(1); // one display frame
  text("Root");
  text("Root");
  w.u8(1);
  w.i32(model.bones.length > 0 ? 1 : 0);
  if (model.bones.length > 0) {
    w.u8(0);
    index(0);
  }

  w.i32(model.rigidBodies.length);
  for (const b of model.rigidBodies) {
    text(b.name);
    text(b.nameEn);
    index(b.bone);
    w.u8(b.group);
    w.u16(b.collisionMask);
    w.u8(b.shape);
    w.vec(b.size);
    w.vec(b.position);
    w.vec(b.rotation);
    for (const v of [b.mass, b.linearDamping, b.angularDamping, b.restitution, b.friction]) w.f32(v);
    w.u8(b.mode);
  }

  w.i32(model.joints.length);
  for (const j of model.joints) {
    text(j.name);
    text("");
    w.u8(j.type);
    index(j.bodyA);
    index(j.bodyB);
    for (const v of [j.position, j.rotation, j.positionMin, j.positionMax, j.rotationMin, j.rotationMax, j.positionSpring, j.rotationSpring]) w.vec(v);
  }
  if ((model.version ?? 2) > 2.05) w.i32(model.softBodyCount ?? 0);
  return w.done();
}

class Writer {
  constructor() {
    this.buffer = Buffer.alloc(1 << 16);
    this.offset = 0;
  }

  ensure(n) {
    if (this.offset + n <= this.buffer.length) return;
    const next = Buffer.alloc(Math.max(this.buffer.length * 2, this.offset + n));
    this.buffer.copy(next, 0, 0, this.offset);
    this.buffer = next;
  }

  bytes(values) {
    this.ensure(values.length);
    for (const v of values) this.buffer[this.offset++] = v;
  }

  u8(v) {
    this.ensure(1);
    this.buffer.writeUInt8(v, this.offset++);
  }

  u16(v) {
    this.ensure(2);
    this.buffer.writeUInt16LE(v, this.offset);
    this.offset += 2;
  }

  i32(v) {
    this.ensure(4);
    this.buffer.writeInt32LE(v, this.offset);
    this.offset += 4;
  }

  f32(v) {
    this.ensure(4);
    this.buffer.writeFloatLE(v, this.offset);
    this.offset += 4;
  }

  vec(values) {
    for (const v of values) this.f32(v);
  }

  index(v, size) {
    this.ensure(size);
    if (size === 1) this.buffer.writeInt8(v, this.offset);
    else if (size === 2) this.buffer.writeInt16LE(v, this.offset);
    else this.buffer.writeInt32LE(v, this.offset);
    this.offset += size;
  }

  unsigned(v, size) {
    this.ensure(size);
    if (size === 1) this.buffer.writeUInt8(v, this.offset);
    else if (size === 2) this.buffer.writeUInt16LE(v, this.offset);
    else this.buffer.writeInt32LE(v | 0, this.offset); // PMX stores four-byte vertex indices signed
    this.offset += size;
  }

  done() {
    return new Uint8Array(this.buffer.subarray(0, this.offset));
  }
}
