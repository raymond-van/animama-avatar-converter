/**
 * Reads MikuMikuDance PMX 2.0 and 2.1 models. Ported from pmx-to-vrm's
 * `PmxReader` (MIT, see LICENSE-pmx-to-vrm), which follows the public PMX
 * format description. Values stay as stored: MMD units, left-handed, model
 * facing -Z. PMD, the older format, is not read.
 */

/**
 * @typedef {[number, number, number]} Vec3
 * @typedef {[number, number, number, number]} Vec4
 *
 * @typedef {object} PmxMaterial
 * @property {string} name
 * @property {string} nameEn
 * @property {Vec4} diffuse RGBA.
 * @property {Vec3} specular
 * @property {number} specularPower
 * @property {Vec3} ambient
 * @property {number} flags 0x01 double-sided, 0x10 edge (outline); see MATERIAL_FLAGS.
 * @property {Vec4} edgeColor
 * @property {number} edgeSize
 * @property {number} textureIndex -1 when none.
 * @property {number} sphereIndex -1 when none.
 * @property {number} sphereMode 0 off, 1 multiply (.sph), 2 add (.spa), 3 sub-texture.
 * @property {boolean} sharedToon true: `toonIndex` 0–9 names MMD's shared toon01–toon10.
 * @property {number} toonIndex A shared toon number or a texture index; -1 when none.
 * @property {string} memo
 * @property {number} indexCount Indices (three per triangle) this material draws, in file order.
 *
 * @typedef {object} PmxIkLink
 * @property {number} bone
 * @property {boolean} hasLimits
 * @property {Vec3} min
 * @property {Vec3} max
 *
 * @typedef {object} PmxBone
 * @property {string} name
 * @property {string} nameEn
 * @property {Vec3} position
 * @property {number} parent -1 for a root.
 * @property {number} layer
 * @property {number} flags See BONE_FLAGS.
 * @property {number} tailBone -1 when the tail is an offset.
 * @property {Vec3} tailOffset
 * @property {number} inheritParent The append (付与) source, -1 when none.
 * @property {number} inheritWeight
 * @property {{target: number, loops: number, limitAngle: number, links: PmxIkLink[]} | null} ik
 *
 * @typedef {object} PmxMaterialOffset
 * @property {number} material -1 for every material.
 * @property {number} operation 0 multiply, 1 add.
 * @property {Vec4} diffuse
 * @property {Vec3} specular
 * @property {number} specularPower
 * @property {Vec3} ambient
 * @property {Vec4} edgeColor
 * @property {number} edgeSize
 * @property {Vec4} textureTint
 * @property {Vec4} sphereTint
 * @property {Vec4} toonTint
 *
 * @typedef {object} PmxMorph
 * @property {string} name
 * @property {string} nameEn
 * @property {number} panel 1 brow, 2 eye, 3 mouth, 4 other, 0 system.
 * @property {number} type See MORPH_TYPES.
 * @property {{morph: number, weight: number}[]} group Group and flip parts.
 * @property {{vertex: number, offset: Vec3}[]} vertex
 * @property {{bone: number, translation: Vec3, rotation: Vec4}[]} bone Rotation is a quaternion (x, y, z, w).
 * @property {{vertex: number, offset: Vec4}[]} uv
 * @property {PmxMaterialOffset[]} material
 * @property {number} impulseCount Impulse parts are counted, not kept.
 *
 * @typedef {object} PmxRigidBody
 * @property {string} name
 * @property {string} nameEn
 * @property {number} bone -1 when none.
 * @property {number} group 0–15.
 * @property {number} collisionMask Bit g set: collides with group g.
 * @property {number} shape 0 sphere, 1 box, 2 capsule.
 * @property {Vec3} size Sphere: x radius. Box: half extents. Capsule: x radius, y cylinder height.
 * @property {Vec3} position
 * @property {Vec3} rotation Euler radians, applied Y, X, Z.
 * @property {number} mass
 * @property {number} linearDamping
 * @property {number} angularDamping
 * @property {number} restitution
 * @property {number} friction
 * @property {number} mode 0 follows its bone, 1 physics, 2 physics with the bone's position.
 *
 * @typedef {object} PmxJoint
 * @property {string} name
 * @property {number} type
 * @property {number} bodyA
 * @property {number} bodyB
 * @property {Vec3} position
 * @property {Vec3} rotation
 * @property {Vec3} positionMin
 * @property {Vec3} positionMax
 * @property {Vec3} rotationMin
 * @property {Vec3} rotationMax
 * @property {Vec3} positionSpring
 * @property {Vec3} rotationSpring
 *
 * @typedef {object} PmxModel
 * @property {number} version
 * @property {0 | 1} encoding 0 UTF-16LE, 1 UTF-8.
 * @property {number} additionalUvCount Read past, not kept.
 * @property {string} name
 * @property {string} nameEn
 * @property {string} comment
 * @property {string} commentEn
 * @property {number} vertexCount
 * @property {Float32Array} positions xyz per vertex.
 * @property {Float32Array} normals xyz per vertex.
 * @property {Float32Array} uvs uv per vertex.
 * @property {Uint8Array} weightTypes 0 BDEF1, 1 BDEF2, 2 BDEF4, 3 SDEF, 4 QDEF.
 * @property {Int32Array} skinBones Four bone indices per vertex, -1 unused.
 * @property {Float32Array} skinWeights Four weights per vertex.
 * @property {Float32Array} edgeScales
 * @property {Uint32Array} indices Three per triangle, in MMD's (DirectX) winding.
 * @property {string[]} textures Paths relative to the model, as stored.
 * @property {PmxMaterial[]} materials
 * @property {PmxBone[]} bones
 * @property {PmxMorph[]} morphs
 * @property {PmxRigidBody[]} rigidBodies
 * @property {PmxJoint[]} joints
 * @property {number} softBodyCount PMX 2.1 soft bodies, counted only.
 */

export const MATERIAL_FLAGS = Object.freeze({
  doubleSided: 0x01,
  groundShadow: 0x02,
  castShadow: 0x04,
  receiveShadow: 0x08,
  edge: 0x10,
  vertexColor: 0x20,
  pointDraw: 0x40,
  lineDraw: 0x80,
});

export const BONE_FLAGS = Object.freeze({
  tailIsBone: 0x0001,
  rotatable: 0x0002,
  translatable: 0x0004,
  visible: 0x0008,
  enabled: 0x0010,
  ik: 0x0020,
  inheritRotation: 0x0100,
  inheritTranslation: 0x0200,
  fixedAxis: 0x0400,
  localAxis: 0x0800,
  physicsAfterDeform: 0x1000,
  externalParent: 0x2000,
});

export const MORPH_TYPES = Object.freeze({
  group: 0,
  vertex: 1,
  bone: 2,
  uv: 3,
  uv1: 4,
  uv2: 5,
  uv3: 6,
  uv4: 7,
  material: 8,
  flip: 9,
  impulse: 10,
});

/** A file that is not a readable PMX model. */
export class PmxFormatError extends Error {}

const MAX_COUNT = 50_000_000;
const MAX_TEXT = 1 << 24;

/**
 * Parse a PMX file's bytes.
 * @param {Uint8Array} bytes
 * @returns {PmxModel}
 */
export function readPmx(bytes) {
  const r = new Reader(bytes);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4d || bytes[2] !== 0x58)
    throw new PmxFormatError(
      bytes[0] === 0x50 && bytes[1] === 0x6d && bytes[2] === 0x64
        ? "This is a PMD file, MikuMikuDance's older format, which is not supported. Convert it to PMX first, for example with PMX Editor."
        : "Not a PMX file: it does not start with the PMX signature.",
    );
  r.offset = 4;
  const version = Math.round(r.f32() * 100) / 100;
  if (version < 2 || version > 2.1)
    throw new PmxFormatError(`Unsupported PMX version ${version}; only 2.0 and 2.1 are read.`);
  const globals = r.bytes(r.u8());
  if (globals.length < 8) throw new PmxFormatError("The PMX header is too short.");
  const [encoding, additionalUvCount, vertexSize, textureSize, materialSize, boneSize, morphSize, bodySize] = globals;
  if (encoding > 1) throw new PmxFormatError(`Unknown PMX text encoding ${encoding}.`);
  for (const size of [vertexSize, textureSize, materialSize, boneSize, morphSize, bodySize])
    if (![1, 2, 4].includes(size)) throw new PmxFormatError(`Bad index size ${size} in the PMX header.`);
  if (additionalUvCount > 4) throw new PmxFormatError(`Invalid additional UV count ${additionalUvCount}.`);
  r.utf8 = encoding === 1;
  r.vertexSize = vertexSize;
  const index = (size) => r.index(size);
  const bone = () => r.index(boneSize);

  const name = r.text();
  const nameEn = r.text();
  const comment = r.text();
  const commentEn = r.text();

  const vertexCount = r.count("vertex", 37 + 16 * additionalUvCount);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const weightTypes = new Uint8Array(vertexCount);
  const skinBones = new Int32Array(vertexCount * 4).fill(-1);
  const skinWeights = new Float32Array(vertexCount * 4);
  const edgeScales = new Float32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    for (let k = 0; k < 3; k++) positions[v * 3 + k] = r.f32();
    for (let k = 0; k < 3; k++) normals[v * 3 + k] = r.f32();
    uvs[v * 2] = r.f32();
    uvs[v * 2 + 1] = r.f32();
    r.skip(16 * additionalUvCount);
    const type = r.u8();
    weightTypes[v] = type;
    const b = v * 4;
    if (type === 0) {
      skinBones[b] = bone();
      skinWeights[b] = 1;
    } else if (type === 1 || type === 3) {
      skinBones[b] = bone();
      skinBones[b + 1] = bone();
      const w = r.f32();
      skinWeights[b] = w;
      skinWeights[b + 1] = 1 - w;
      if (type === 3) r.skip(36); // SDEF C, R0, R1: skinned linearly.
    } else if (type === 2 || type === 4) {
      for (let k = 0; k < 4; k++) skinBones[b + k] = bone();
      for (let k = 0; k < 4; k++) skinWeights[b + k] = r.f32();
    } else throw new PmxFormatError(`Vertex ${v} has unknown weight type ${type}.`);
    edgeScales[v] = r.f32();
  }

  const indexCount = r.count("index", vertexSize);
  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    const value = r.vertexIndex();
    if (value < 0 || value >= vertexCount) throw new PmxFormatError(`Face index ${i} names vertex ${value} of ${vertexCount}.`);
    indices[i] = value;
  }

  const textures = Array.from({ length: r.count("texture", 4) }, () => r.text());

  /** @type {PmxMaterial[]} */
  const materials = [];
  for (let i = r.count("material", 82 + 2 * textureSize); i > 0; i--) {
    const material = {
      name: r.text(),
      nameEn: r.text(),
      diffuse: r.vec4(),
      specular: r.vec3(),
      specularPower: r.f32(),
      ambient: r.vec3(),
      flags: r.u8(),
      edgeColor: r.vec4(),
      edgeSize: r.f32(),
      textureIndex: index(textureSize),
      sphereIndex: index(textureSize),
      sphereMode: r.u8(),
      sharedToon: false,
      toonIndex: -1,
      memo: "",
      indexCount: 0,
    };
    material.sharedToon = r.u8() === 1;
    material.toonIndex = material.sharedToon ? r.u8() : index(textureSize);
    material.memo = r.text();
    material.indexCount = r.i32();
    materials.push(material);
  }
  const drawn = materials.reduce((sum, material) => sum + material.indexCount, 0);
  if (drawn > indexCount || materials.some((material) => material.indexCount < 0 || material.indexCount % 3 !== 0))
    throw new PmxFormatError("The materials' face counts do not match the model's faces.");

  /** @type {PmxBone[]} */
  const bones = [];
  for (let i = r.count("bone", 26 + boneSize), n = 0; n < i; n++) {
    /** @type {PmxBone} */
    const b = {
      name: r.text(),
      nameEn: r.text(),
      position: r.vec3(),
      parent: bone(),
      layer: r.i32(),
      flags: r.u16(),
      tailBone: -1,
      tailOffset: [0, 0, 0],
      inheritParent: -1,
      inheritWeight: 0,
      ik: null,
    };
    if (b.flags & BONE_FLAGS.tailIsBone) b.tailBone = bone();
    else b.tailOffset = r.vec3();
    if (b.flags & (BONE_FLAGS.inheritRotation | BONE_FLAGS.inheritTranslation)) {
      b.inheritParent = bone();
      b.inheritWeight = r.f32();
    }
    if (b.flags & BONE_FLAGS.fixedAxis) r.skip(12);
    if (b.flags & BONE_FLAGS.localAxis) r.skip(24);
    if (b.flags & BONE_FLAGS.externalParent) r.skip(4);
    if (b.flags & BONE_FLAGS.ik) {
      const ik = { target: bone(), loops: r.i32(), limitAngle: r.f32(), links: [] };
      const links = r.i32();
      if (links < 0 || links > 4096) throw new PmxFormatError(`Bone ${n} has a bad IK link count ${links}.`);
      for (let k = 0; k < links; k++) {
        const link = { bone: bone(), hasLimits: r.u8() !== 0, min: [0, 0, 0], max: [0, 0, 0] };
        if (link.hasLimits) {
          link.min = r.vec3();
          link.max = r.vec3();
        }
        ik.links.push(link);
      }
      b.ik = ik;
    }
    bones.push(b);
  }

  /** @type {PmxMorph[]} */
  const morphs = [];
  for (let i = r.count("morph", 14), n = 0; n < i; n++) {
    /** @type {PmxMorph} */
    const morph = {
      name: r.text(),
      nameEn: r.text(),
      panel: r.u8(),
      type: r.u8(),
      group: [],
      vertex: [],
      bone: [],
      uv: [],
      material: [],
      impulseCount: 0,
    };
    const parts = r.count("morph offset", 5);
    for (let k = 0; k < parts; k++) {
      switch (morph.type) {
        case MORPH_TYPES.group:
        case MORPH_TYPES.flip:
          morph.group.push({ morph: index(morphSize), weight: r.f32() });
          break;
        case MORPH_TYPES.vertex:
          morph.vertex.push({ vertex: r.vertexIndex(), offset: r.vec3() });
          break;
        case MORPH_TYPES.bone:
          morph.bone.push({ bone: bone(), translation: r.vec3(), rotation: r.vec4() });
          break;
        case MORPH_TYPES.uv:
        case MORPH_TYPES.uv1:
        case MORPH_TYPES.uv2:
        case MORPH_TYPES.uv3:
        case MORPH_TYPES.uv4:
          morph.uv.push({ vertex: r.vertexIndex(), offset: r.vec4() });
          break;
        case MORPH_TYPES.material:
          morph.material.push({
            material: index(materialSize),
            operation: r.u8(),
            diffuse: r.vec4(),
            specular: r.vec3(),
            specularPower: r.f32(),
            ambient: r.vec3(),
            edgeColor: r.vec4(),
            edgeSize: r.f32(),
            textureTint: r.vec4(),
            sphereTint: r.vec4(),
            toonTint: r.vec4(),
          });
          break;
        case MORPH_TYPES.impulse:
          index(bodySize);
          r.skip(25);
          morph.impulseCount += 1;
          break;
        default:
          throw new PmxFormatError(`Morph ${n} (${morph.name}) has unknown type ${morph.type}.`);
      }
    }
    for (const part of [...morph.vertex, ...morph.uv])
      if (part.vertex < 0 || part.vertex >= vertexCount)
        throw new PmxFormatError(`Morph ${morph.name} names vertex ${part.vertex} of ${vertexCount}.`);
    morphs.push(morph);
  }

  for (let i = r.count("display frame", 13); i > 0; i--) {
    r.text();
    r.text();
    r.u8();
    for (let k = r.count("display frame item", 2); k > 0; k--) {
      if (r.u8() === 0) bone();
      else index(morphSize);
    }
  }

  /** @type {PmxRigidBody[]} */
  const rigidBodies = [];
  for (let i = r.count("rigid body", 69 + boneSize); i > 0; i--) {
    rigidBodies.push({
      name: r.text(),
      nameEn: r.text(),
      bone: bone(),
      group: r.u8(),
      collisionMask: r.u16(),
      shape: r.u8(),
      size: r.vec3(),
      position: r.vec3(),
      rotation: r.vec3(),
      mass: r.f32(),
      linearDamping: r.f32(),
      angularDamping: r.f32(),
      restitution: r.f32(),
      friction: r.f32(),
      mode: r.u8(),
    });
  }

  /** @type {PmxJoint[]} */
  const joints = [];
  for (let i = r.count("joint", 105 + 2 * bodySize); i > 0; i--) {
    const name = r.text();
    r.text(); // English name
    joints.push({
      name,
      type: r.u8(),
      bodyA: index(bodySize),
      bodyB: index(bodySize),
      position: r.vec3(),
      rotation: r.vec3(),
      positionMin: r.vec3(),
      positionMax: r.vec3(),
      rotationMin: r.vec3(),
      rotationMax: r.vec3(),
      positionSpring: r.vec3(),
      rotationSpring: r.vec3(),
    });
  }

  // PMX 2.1 soft bodies follow; they are counted, not converted.
  const softBodyCount = version > 2.05 && r.offset + 4 <= bytes.length ? r.i32() : 0;

  return {
    version,
    encoding: /** @type {0 | 1} */ (encoding),
    additionalUvCount,
    name,
    nameEn,
    comment,
    commentEn,
    vertexCount,
    positions,
    normals,
    uvs,
    weightTypes,
    skinBones,
    skinWeights,
    edgeScales,
    indices,
    textures,
    materials,
    bones,
    morphs,
    rigidBodies,
    joints,
    softBodyCount,
  };
}

class Reader {
  /** @param {Uint8Array} bytes */
  constructor(bytes) {
    this.bytes_ = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
    this.utf8 = false;
    this.vertexSize = 4;
    this.utf16Decoder = new TextDecoder("utf-16le");
    this.utf8Decoder = new TextDecoder("utf-8");
  }

  need(n) {
    if (this.offset + n > this.bytes_.length)
      throw new PmxFormatError(`The PMX file ends early, at byte ${this.offset} of ${this.bytes_.length}.`);
  }

  skip(n) {
    this.need(n);
    this.offset += n;
  }

  u8() {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  u16() {
    this.need(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i32() {
    this.need(4);
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /** A float; NaN and infinities, which no PMX value may hold, read as 0. */
  f32() {
    this.need(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return Number.isFinite(value) ? value : 0;
  }

  /** @returns {Vec3} */
  vec3() {
    return [this.f32(), this.f32(), this.f32()];
  }

  /** @returns {Vec4} */
  vec4() {
    return [this.f32(), this.f32(), this.f32(), this.f32()];
  }

  bytes(n) {
    this.need(n);
    const out = this.bytes_.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /**
   * A record count, checked against the bytes left so a corrupt count cannot
   * make the reader allocate gigabytes.
   * @param {string} what
   * @param {number} minimumSize The smallest a record can be, in bytes.
   */
  count(what, minimumSize) {
    const n = this.i32();
    if (n < 0 || n > MAX_COUNT) throw new PmxFormatError(`Bad ${what} count ${n}.`);
    if (n * minimumSize > this.bytes_.length - this.offset)
      throw new PmxFormatError(`The PMX file ends early: it declares ${n} ${what} records, more than its remaining bytes can hold.`);
    return n;
  }

  text() {
    const length = this.i32();
    if (length < 0 || length > MAX_TEXT) throw new PmxFormatError(`Bad text length ${length} at byte ${this.offset - 4}.`);
    if (length === 0) return "";
    const raw = this.bytes(length);
    return (this.utf8 ? this.utf8Decoder : this.utf16Decoder).decode(raw).replace(/\0+$/, "");
  }

  /** Vertex indices are unsigned for sizes 1 and 2. */
  vertexIndex() {
    switch (this.vertexSize) {
      case 1:
        return this.u8();
      case 2:
        return this.u16();
      case 4:
        return this.i32();
      default:
        throw new PmxFormatError(`Bad vertex index size ${this.vertexSize}.`);
    }
  }

  /** Other indices are signed; -1 means none. */
  index(size) {
    switch (size) {
      case 1: {
        this.need(1);
        return this.view.getInt8(this.offset++);
      }
      case 2: {
        this.need(2);
        const value = this.view.getInt16(this.offset, true);
        this.offset += 2;
        return value;
      }
      case 4:
        return this.i32();
      default:
        throw new PmxFormatError(`Bad index size ${size}.`);
    }
  }
}
