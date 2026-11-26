/**
 * Builds a glTF 2.0 binary (GLB): one buffer, its views and accessors, and
 * the JSON document. Adapted from pmx-to-vrm's `GltfBuilder` (MIT), with
 * sparse morph-target accessors.
 */

export const FLOAT = 5126;
export const UNSIGNED_BYTE = 5121;
export const UNSIGNED_SHORT = 5123;
export const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export class GltfBuilder {
  constructor() {
    /** @type {Uint8Array[]} */
    this.chunks = [];
    this.byteLength = 0;
    /** @type {object[]} */ this.bufferViews = [];
    /** @type {object[]} */ this.accessors = [];
    /** @type {object[]} */ this.images = [];
    /** @type {object[]} */ this.samplers = [];
    /** @type {object[]} */ this.textures = [];
    /** @type {object[]} */ this.materials = [];
    /** @type {object[]} */ this.meshes = [];
    /** @type {object[]} */ this.nodes = [];
    /** @type {object[]} */ this.skins = [];
  }

  /**
   * Append bytes to the buffer, 4-byte aligned.
   * @param {ArrayBufferView} data
   * @param {number} [target]
   */
  addBufferView(data, target) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(new Uint8Array(pad));
      this.byteLength += pad;
    }
    const view = { buffer: 0, byteOffset: this.byteLength, byteLength: bytes.byteLength };
    if (target !== undefined) view.target = target;
    this.chunks.push(bytes);
    this.byteLength += bytes.byteLength;
    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }

  /** @param {object} accessor */
  accessor(accessor) {
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  /**
   * A float vertex attribute.
   * @param {Float32Array} data
   * @param {"VEC2" | "VEC3" | "VEC4"} type
   * @param {boolean} [minMax]
   */
  addFloats(data, type, minMax = false) {
    const size = { VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const accessor = {
      bufferView: this.addBufferView(data, ARRAY_BUFFER),
      componentType: FLOAT,
      count: data.length / size,
      type,
    };
    if (minMax) Object.assign(accessor, bounds(data, size));
    return this.accessor(accessor);
  }

  /** @param {Uint16Array} data Four joint indices per vertex. */
  addJoints(data) {
    return this.accessor({
      bufferView: this.addBufferView(data, ARRAY_BUFFER),
      componentType: UNSIGNED_SHORT,
      count: data.length / 4,
      type: "VEC4",
    });
  }

  /**
   * @param {Uint32Array} indices
   * @param {number} vertexCount
   */
  addIndices(indices, vertexCount) {
    const small = vertexCount <= 65535;
    const data = small ? Uint16Array.from(indices) : indices;
    return this.accessor({
      bufferView: this.addBufferView(data, ELEMENT_ARRAY_BUFFER),
      componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
      count: data.length,
      type: "SCALAR",
    });
  }

  /** @param {Float32Array} columnMajor 16 floats per matrix. */
  addMatrices(columnMajor) {
    return this.accessor({
      bufferView: this.addBufferView(columnMajor),
      componentType: FLOAT,
      count: columnMajor.length / 16,
      type: "MAT4",
    });
  }

  /**
   * A morph target's POSITION offsets stored sparse: only the vertices it
   * moves. A target that moves nothing has no data at all (all zeros).
   * @param {number} vertexCount
   * @param {Uint32Array} vertices Strictly increasing vertex indices.
   * @param {Float32Array} offsets xyz per listed vertex.
   */
  addSparseVec3(vertexCount, vertices, offsets) {
    /** @type {any} */
    const accessor = { componentType: FLOAT, count: vertexCount, type: "VEC3" };
    if (vertices.length === 0) return this.accessor({ ...accessor, min: [0, 0, 0], max: [0, 0, 0] });
    const { min, max } = bounds(offsets, 3);
    if (vertices.length < vertexCount)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], 0);
        max[k] = Math.max(max[k], 0);
      }
    const small = vertexCount <= 65535;
    return this.accessor({
      ...accessor,
      min,
      max,
      sparse: {
        count: vertices.length,
        indices: {
          bufferView: this.addBufferView(small ? Uint16Array.from(vertices) : vertices),
          componentType: small ? UNSIGNED_SHORT : UNSIGNED_INT,
        },
        values: { bufferView: this.addBufferView(offsets) },
      },
    });
  }

  /**
   * @param {Uint8Array} data
   * @param {string} mimeType
   * @param {string} name
   */
  addImage(data, mimeType, name) {
    this.images.push({ name, bufferView: this.addBufferView(data), mimeType });
    return this.images.length - 1;
  }

  /** @param {object} sampler */
  addSampler(sampler) {
    const json = JSON.stringify(sampler);
    const found = this.samplers.findIndex((s) => JSON.stringify(s) === json);
    if (found >= 0) return found;
    this.samplers.push(sampler);
    return this.samplers.length - 1;
  }

  /**
   * @param {number} image
   * @param {number} sampler
   */
  addTexture(image, sampler) {
    this.textures.push({ source: image, sampler });
    return this.textures.length - 1;
  }

  /**
   * The GLB bytes for a document whose other top-level fields are in `root`.
   * @param {Record<string, unknown>} root
   * @returns {Buffer}
   */
  toGlb(root) {
    const binPad = (4 - (this.byteLength % 4)) % 4;
    const binLength = this.byteLength + binPad;
    const document = { ...root, buffers: [{ byteLength: binLength }] };
    for (const key of ["bufferViews", "accessors", "images", "samplers", "textures", "materials", "meshes", "nodes", "skins"])
      if (this[key].length > 0) document[key] = this[key];
    const json = Buffer.from(JSON.stringify(document), "utf8");
    const jsonPad = (4 - (json.length % 4)) % 4;
    const jsonLength = json.length + jsonPad;
    const total = 12 + 8 + jsonLength + 8 + binLength;
    const header = Buffer.alloc(20);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(total, 8);
    header.writeUInt32LE(jsonLength, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binLength, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat(
      [header, json, Buffer.alloc(jsonPad, 0x20), binHeader, ...this.chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), Buffer.alloc(binPad)],
      total,
    );
  }
}

/**
 * Exact float32 min and max per component (accessor bounds must match the
 * data bit for bit).
 * @param {Float32Array} data
 * @param {number} size
 */
function bounds(data, size) {
  const min = new Array(size).fill(Infinity);
  const max = new Array(size).fill(-Infinity);
  for (let i = 0; i < data.length; i += size)
    for (let k = 0; k < size; k++) {
      const v = data[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  return { min: min.map((v) => (Number.isFinite(v) ? v : 0)), max: max.map((v) => (Number.isFinite(v) ? v : 0)) };
}

/**
 * Read a GLB's JSON and binary chunks (for tests and checks).
 * @param {Uint8Array} glb
 */
export function readGlb(glb) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB.");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return { json, bin: glb.subarray(binStart + 8, binStart + 8 + binLength) };
}
