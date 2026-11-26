import { deflateSync, inflateSync } from "node:zlib";

/**
 * Texture reading for PMX models. Ported from pmx-to-vrm's `Images` (MIT, see
 * LICENSE-pmx-to-vrm): a PNG encoder and decoder, and BMP, TGA and DDS (DXT1,
 * DXT3, DXT5 and uncompressed) decoders. PNG and JPEG files are embedded as
 * they are; the others are re-encoded as PNG, which glTF requires.
 */

/**
 * 8-bit RGBA pixels, top row first.
 * @typedef {{width: number, height: number, pixels: Uint8Array}} RgbaImage
 * @typedef {"png" | "jpeg" | "bmp" | "tga" | "dds" | "gif" | "unknown"} ImageKind
 */

export class ImageFormatError extends Error {}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
/** 8192 × 8192: larger textures are refused rather than risking memory. */
const MAX_PIXELS = 8192 * 8192;

/**
 * @param {number} width
 * @param {number} height
 * @returns {RgbaImage}
 */
export function createImage(width, height) {
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS)
    throw new ImageFormatError(`Bad image size ${width}x${height}.`);
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}

/**
 * The format from the file's bytes, falling back to the extension for TGA,
 * which has no signature. MMD sphere maps (.sph, .spa) are usually BMPs.
 * @param {Uint8Array} bytes
 * @param {string} path
 * @returns {ImageKind}
 */
export function detectImageKind(bytes, path) {
  if (isPng(bytes)) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes[0] === 0x44 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x20) return "dds";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "gif";
  if (/\.tga$/i.test(path)) return "tga";
  return "unknown";
}

/**
 * Decode an image to RGBA, or null for JPEG (embedded as it is, never needs
 * pixels) and formats this module cannot read.
 * @param {Uint8Array} bytes
 * @param {ImageKind} kind
 * @returns {RgbaImage | null}
 */
export function decodeImage(bytes, kind) {
  switch (kind) {
    case "png":
      return decodePng(bytes);
    case "bmp":
      return decodeBmp(bytes);
    case "tga":
      return decodeTga(bytes);
    case "dds":
      return decodeDds(bytes);
    default:
      return null;
  }
}

/** @param {Uint8Array} bytes */
export function isPng(bytes) {
  return bytes.length >= 8 && PNG_SIGNATURE.every((value, i) => bytes[i] === value);
}

/**
 * How a texture uses alpha: opaque when (almost) every pixel is opaque,
 * cutout when the others are nearly all fully clear (hard-edged masks), blend
 * otherwise.
 * @param {RgbaImage} image
 * @returns {"opaque" | "cutout" | "blend"}
 */
export function alphaUsage(image) {
  const p = image.pixels;
  let clear = 0;
  let partial = 0;
  for (let i = 3; i < p.length; i += 4) {
    const a = p[i];
    if (a >= 250) continue;
    if (a <= 8) clear += 1;
    else partial += 1;
  }
  const total = p.length / 4;
  const seen = clear + partial;
  if (seen === 0 || seen * 2000 < total) return "opaque";
  return partial <= seen / 10 ? "cutout" : "blend";
}

// ─── PNG ─────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE((crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}

/**
 * Encode RGBA pixels as an 8-bit RGBA PNG. Rows use the "up" filter, which is
 * cheap and compresses texture rows well.
 * @param {RgbaImage} image
 * @returns {Buffer}
 */
export function encodePng(image) {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);
  const p = image.pixels;
  for (let y = 0; y < image.height; y++) {
    const out = y * (stride + 1);
    const row = y * stride;
    raw[out] = 2;
    if (y === 0) for (let i = 0; i < stride; i++) raw[out + 1 + i] = p[row + i];
    else for (let i = 0; i < stride; i++) raw[out + 1 + i] = (p[row + i] - p[row - stride + i]) & 0xff;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Decode a PNG of any standard colour type and depth, interlaced or not.
 * @param {Uint8Array} bytes
 * @returns {RgbaImage}
 */
export function decodePng(bytes) {
  if (!isPng(bytes)) throw new ImageFormatError("Not a PNG.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  /** @type {Uint8Array | null} */
  let palette = null;
  /** @type {Uint8Array | null} */
  let trns = null;
  const idat = [];
  while (pos + 8 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const start = pos + 8;
    if (start + length > bytes.length) throw new ImageFormatError("Truncated PNG chunk.");
    const data = bytes.subarray(start, start + length);
    if (type === "IHDR") {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    pos = start + length + 4;
    if (type === "IEND") break;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new ImageFormatError(`Unsupported PNG colour type ${colorType}.`);
  const image = createImage(width, height);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rowBytes = (w) => Math.ceil((w * bitsPerPixel) / 8) + 1;
  let expected = rowBytes(width) * height;
  if (interlace !== 0) {
    expected = 0;
    for (const [sx, sy, dx, dy] of [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]) {
      const pw = Math.ceil((width - sx) / dx);
      const ph = Math.ceil((height - sy) / dy);
      if (pw > 0 && ph > 0) expected += rowBytes(pw) * ph;
    }
  }
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch (error) {
    throw new ImageFormatError(`Bad PNG data (${error.code ?? error.message}).`);
  }
  const state = { offset: 0 };
  const put = pixelWriter(image, depth, colorType, palette, trns);
  if (interlace === 0) unfilter(raw, state, width, height, bitsPerPixel, bpp, put, 0, 0, 1, 1);
  else {
    const sx = [0, 4, 0, 2, 0, 1, 0];
    const sy = [0, 0, 4, 0, 2, 0, 1];
    const dx = [8, 8, 4, 4, 2, 2, 1];
    const dy = [8, 8, 8, 4, 4, 2, 2];
    for (let pass = 0; pass < 7; pass++) {
      const pw = Math.ceil((width - sx[pass]) / dx[pass]);
      const ph = Math.ceil((height - sy[pass]) / dy[pass]);
      if (pw > 0 && ph > 0) unfilter(raw, state, pw, ph, bitsPerPixel, bpp, put, sx[pass], sy[pass], dx[pass], dy[pass]);
    }
  }
  return image;
}

function unfilter(raw, state, w, h, bitsPerPixel, bpp, put, ox, oy, sx, sy) {
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    if (state.offset + 1 + stride > raw.length) throw new ImageFormatError("Truncated PNG data.");
    const filter = raw[state.offset++];
    cur.set(raw.subarray(state.offset, state.offset + stride));
    state.offset += stride;
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let i = bpp; i < stride; i++) cur[i] = (cur[i] + cur[i - bpp]) & 0xff;
        break;
      case 2:
        for (let i = 0; i < stride; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
        break;
      case 3:
        for (let i = 0; i < stride; i++) cur[i] = (cur[i] + (((i >= bpp ? cur[i - bpp] : 0) + prev[i]) >> 1)) & 0xff;
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? cur[i - bpp] : 0;
          const b = prev[i];
          const c = i >= bpp ? prev[i - bpp] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
        }
        break;
      default:
        throw new ImageFormatError(`Unknown PNG filter ${filter}.`);
    }
    put(cur, w, oy + y * sy, ox, sx);
    [prev, cur] = [cur, prev];
  }
}

/** A function that writes one unfiltered row into the image. */
function pixelWriter(image, depth, colorType, palette, trns) {
  const out = image.pixels;
  const width = image.width;
  const set = (x, y, r, g, b, a) => {
    const o = (y * width + x) * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  };
  const sample = (line, index) => {
    if (depth === 8) return line[index];
    if (depth === 16) return (line[index * 2] << 8) | line[index * 2 + 1];
    const bit = index * depth;
    return (line[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };
  const scale = (value) => (depth === 16 ? value >> 8 : depth === 8 ? value : Math.round((value * 255) / ((1 << depth) - 1)));
  const key16 = (data, i) => (data[i] << 8) | data[i + 1];
  return (line, count, y, ox, sx) => {
    for (let n = 0; n < count; n++) {
      const x = ox + n * sx;
      switch (colorType) {
        case 0: {
          const value = sample(line, n);
          const g = scale(value);
          set(x, y, g, g, g, trns && trns.length >= 2 && key16(trns, 0) === value ? 0 : 255);
          break;
        }
        case 2: {
          const r = sample(line, n * 3);
          const g = sample(line, n * 3 + 1);
          const b = sample(line, n * 3 + 2);
          const clear = trns && trns.length >= 6 && key16(trns, 0) === r && key16(trns, 2) === g && key16(trns, 4) === b;
          set(x, y, scale(r), scale(g), scale(b), clear ? 0 : 255);
          break;
        }
        case 3: {
          const i = sample(line, n);
          if (!palette || i * 3 + 2 >= palette.length) set(x, y, 0, 0, 0, 255);
          else set(x, y, palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2], trns && i < trns.length ? trns[i] : 255);
          break;
        }
        case 4: {
          const g = scale(sample(line, n * 2));
          set(x, y, g, g, g, scale(sample(line, n * 2 + 1)));
          break;
        }
        default:
          set(x, y, scale(sample(line, n * 4)), scale(sample(line, n * 4 + 1)), scale(sample(line, n * 4 + 2)), scale(sample(line, n * 4 + 3)));
      }
    }
  };
}

// ─── BMP ─────────────────────────────────────────────────────────────────────

function maskValue(value, mask) {
  if (!mask) return 0;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  const max = mask >>> shift;
  return Math.round((((value & mask) >>> shift) * 255) / max);
}

function flipVertical(image) {
  const stride = image.width * 4;
  const tmp = new Uint8Array(stride);
  const p = image.pixels;
  for (let y = 0; y < image.height >> 1; y++) {
    const a = y * stride;
    const b = (image.height - 1 - y) * stride;
    tmp.set(p.subarray(a, a + stride));
    p.copyWithin(a, b, b + stride);
    p.set(tmp, b);
  }
}

function flipHorizontal(image) {
  const p = image.pixels;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width >> 1; x++)
      for (let c = 0; c < 4; c++) {
        const a = (y * image.width + x) * 4 + c;
        const b = (y * image.width + image.width - 1 - x) * 4 + c;
        [p[a], p[b]] = [p[b], p[a]];
      }
}

/**
 * @param {Uint8Array} bytes
 * @returns {RgbaImage}
 */
export function decodeBmp(bytes) {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) throw new ImageFormatError("Not a BMP.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dataOffset = view.getInt32(10, true);
  const headerSize = view.getInt32(14, true);
  let width;
  let height;
  let bpp;
  let compression = 0;
  let colorsUsed = 0;
  let rm = 0;
  let gm = 0;
  let bm = 0;
  let am = 0;
  if (headerSize === 12) {
    width = view.getInt16(18, true);
    height = view.getInt16(20, true);
    bpp = view.getInt16(24, true);
  } else {
    width = view.getInt32(18, true);
    height = view.getInt32(22, true);
    bpp = view.getInt16(28, true);
    compression = view.getInt32(30, true);
    colorsUsed = view.getInt32(46, true);
    if (compression === 3 || compression === 6) {
      const at = 14 + 40;
      rm = view.getUint32(at, true);
      gm = view.getUint32(at + 4, true);
      bm = view.getUint32(at + 8, true);
      if (compression === 6 || headerSize >= 56) am = view.getUint32(at + 12, true);
    }
  }
  const topDown = height < 0;
  height = Math.abs(height);
  if (![0, 1, 2, 3, 6].includes(compression)) throw new ImageFormatError(`BMP compression ${compression} is not supported.`);
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new ImageFormatError(`BMP with ${bpp} bits per pixel is not supported.`);
  if (headerSize < 12 || dataOffset < 14 + headerSize || dataOffset > bytes.length)
    throw new ImageFormatError("The BMP's header is corrupt.");
  /** @type {number[][] | null} */
  let palette = null;
  if (bpp <= 8) {
    const entries = colorsUsed > 0 ? Math.min(colorsUsed, 1 << bpp) : 1 << bpp;
    const entrySize = headerSize === 12 ? 3 : 4;
    const at = 14 + headerSize;
    palette = Array.from({ length: entries }, (_, i) => {
      const o = at + i * entrySize;
      return o + 2 < bytes.length ? [bytes[o + 2], bytes[o + 1], bytes[o]] : [0, 0, 0];
    });
  }
  const rle = compression === 1 || compression === 2;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  // Check the data before allocating: run-length data expands at most 255 pixels per two bytes.
  if (rle ? width * height > (bytes.length - dataOffset) * 128 : dataOffset + stride * height > bytes.length)
    throw new ImageFormatError("The BMP's pixel data is truncated.");
  const image = createImage(width, height);
  const set = (x, y, r, g, b, a) => {
    const o = (y * width + x) * 4;
    image.pixels[o] = r;
    image.pixels[o + 1] = g;
    image.pixels[o + 2] = b;
    image.pixels[o + 3] = a;
  };
  if (rle) {
    decodeBmpRle(bytes, dataOffset, width, height, compression === 1 ? 8 : 4, palette ?? [], set);
    if (!topDown) flipVertical(image);
    return image;
  }
  if (bpp === 16 && compression === 0) {
    rm = 0x7c00;
    gm = 0x03e0;
    bm = 0x001f;
  }
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = dataOffset + y * stride;
    const dy = topDown ? y : height - 1 - y;
    for (let x = 0; x < width; x++) {
      switch (bpp) {
        case 1:
        case 4:
        case 8: {
          const bit = x * bpp;
          const index = (bytes[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          const c = palette?.[index] ?? [0, 0, 0];
          set(x, dy, c[0], c[1], c[2], 255);
          break;
        }
        case 24: {
          const o = row + x * 3;
          set(x, dy, bytes[o + 2], bytes[o + 1], bytes[o], 255);
          break;
        }
        case 16: {
          const v = view.getUint16(row + x * 2, true);
          set(x, dy, maskValue(v, rm), maskValue(v, gm), maskValue(v, bm), am ? maskValue(v, am) : 255);
          if (am) anyAlpha = true;
          break;
        }
        case 32: {
          const o = row + x * 4;
          if (compression === 0) {
            set(x, dy, bytes[o + 2], bytes[o + 1], bytes[o], bytes[o + 3]);
            if (bytes[o + 3] !== 0) anyAlpha = true;
          } else {
            const v = view.getUint32(o, true);
            const a = am ? maskValue(v, am) : 255;
            set(x, dy, maskValue(v, rm), maskValue(v, gm), maskValue(v, bm), a);
            if (am && a !== 0) anyAlpha = true;
          }
          break;
        }
        default:
          throw new ImageFormatError(`BMP with ${bpp} bits per pixel is not supported.`);
      }
    }
  }
  // A 32-bit BMP whose alpha channel is all zero has no alpha.
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < image.pixels.length; i += 4) image.pixels[i] = 255;
  return image;
}

function decodeBmpRle(bytes, pos, width, height, bits, palette, set) {
  let x = 0;
  let y = 0; // From the bottom; the caller flips.
  const put = (index) => {
    if (x < width && y < height) {
      const c = palette[index] ?? [0, 0, 0];
      set(x, y, c[0], c[1], c[2], 255);
    }
    x++;
  };
  while (pos + 1 < bytes.length) {
    const n = bytes[pos++];
    const v = bytes[pos++];
    if (n > 0) for (let i = 0; i < n; i++) put(bits === 8 ? v : i % 2 === 0 ? v >> 4 : v & 15);
    else if (v === 0) {
      x = 0;
      y++;
    } else if (v === 1) break;
    else if (v === 2) {
      if (pos + 1 >= bytes.length) break;
      x += bytes[pos++];
      y += bytes[pos++];
    } else {
      const count = bits === 8 ? v : (v + 1) >> 1;
      for (let i = 0; i < v; i++) {
        const b = bytes[pos + (bits === 8 ? i : i >> 1)];
        put(bits === 8 ? b : i % 2 === 0 ? b >> 4 : b & 15);
      }
      pos += count + (count & 1);
    }
  }
}

// ─── TGA ─────────────────────────────────────────────────────────────────────

/**
 * @param {Uint8Array} bytes
 * @returns {RgbaImage}
 */
export function decodeTga(bytes) {
  if (bytes.length < 18) throw new ImageFormatError("The TGA file is too short.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0];
  const colorMapType = bytes[1];
  const type = bytes[2];
  const colorMapFirst = view.getUint16(3, true);
  const colorMapLength = view.getUint16(5, true);
  const colorMapBits = bytes[7];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bpp = bytes[16];
  const descriptor = bytes[17];
  let pos = 18 + idLength;
  const color = (at, bits) => {
    switch (bits) {
      case 32:
        return [bytes[at + 2], bytes[at + 1], bytes[at], bytes[at + 3]];
      case 24:
        return [bytes[at + 2], bytes[at + 1], bytes[at], 255];
      case 15:
      case 16: {
        const v = view.getUint16(at, true);
        return [Math.round((((v >> 10) & 31) * 255) / 31), Math.round((((v >> 5) & 31) * 255) / 31), Math.round(((v & 31) * 255) / 31), 255];
      }
      case 8:
        return [bytes[at], bytes[at], bytes[at], 255];
      default:
        throw new ImageFormatError(`TGA with ${bits}-bit colours is not supported.`);
    }
  };
  /** @type {number[][] | null} */
  let colorMap = null;
  if (colorMapType === 1) {
    const entry = (colorMapBits + 7) >> 3;
    colorMap = [];
    for (let i = 0; i < colorMapLength; i++, pos += entry) colorMap.push(color(pos, colorMapBits));
  }
  const rle = type >= 9;
  const baseType = rle ? type - 8 : type;
  if (baseType < 1 || baseType > 3) throw new ImageFormatError(`TGA image type ${type} is not supported.`);
  if (![8, 15, 16, 24, 32].includes(bpp)) throw new ImageFormatError(`TGA with ${bpp} bits per pixel is not supported.`);
  const pixelBytes = (bpp + 7) >> 3;
  const pixel = (at) => {
    if (at + pixelBytes > bytes.length) throw new ImageFormatError("The TGA's pixel data is truncated.");
    if (baseType === 1) {
      const index = (pixelBytes === 1 ? bytes[at] : view.getUint16(at, true)) - colorMapFirst;
      return colorMap?.[index] ?? [0, 0, 0, 255];
    }
    if (baseType === 3) return [bytes[at], bytes[at], bytes[at], bpp === 16 ? bytes[at + 1] : 255];
    return color(at, bpp);
  };
  const count = width * height;
  if (rle ? count > (bytes.length - pos) * 128 : pos + count * pixelBytes > bytes.length)
    throw new ImageFormatError("The TGA's pixel data is truncated.");
  const image = createImage(width, height);
  const store = (i, c) => image.pixels.set(c, i * 4);
  let i = 0;
  if (!rle) for (; i < count; i++, pos += pixelBytes) store(i, pixel(pos));
  else
    while (i < count && pos < bytes.length) {
      const header = bytes[pos++];
      const n = (header & 0x7f) + 1;
      if (header & 0x80) {
        const c = pixel(pos);
        pos += pixelBytes;
        for (let k = 0; k < n && i < count; k++) store(i++, c);
      } else for (let k = 0; k < n && i < count; k++, pos += pixelBytes) store(i++, pixel(pos));
    }
  // The default origin is bottom-left; bit 5 means top-left, bit 4 right-to-left.
  if ((descriptor & 0x20) === 0) flipVertical(image);
  if (descriptor & 0x10) flipHorizontal(image);
  if (bpp === 32 && (descriptor & 0x0f) === 0) {
    // Many tools write a real alpha channel but declare no alpha bits; drop it only when it is all zero.
    let any = false;
    for (let k = 3; k < image.pixels.length && !any; k += 4) any = image.pixels[k] !== 0;
    if (!any) for (let k = 3; k < image.pixels.length; k += 4) image.pixels[k] = 255;
  }
  return image;
}

// ─── DDS ─────────────────────────────────────────────────────────────────────

/**
 * @param {Uint8Array} bytes
 * @returns {RgbaImage}
 */
export function decodeDds(bytes) {
  if (bytes.length < 128) throw new ImageFormatError("The DDS file is too short.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const height = view.getInt32(12, true);
  const width = view.getInt32(16, true);
  const flags = view.getUint32(80, true);
  const fourCC = String.fromCharCode(bytes[84], bytes[85], bytes[86], bytes[87]);
  const bits = view.getInt32(88, true);
  const rm = view.getUint32(92, true);
  const gm = view.getUint32(96, true);
  const bm = view.getUint32(100, true);
  const am = view.getUint32(104, true);
  const pos = 128;
  if (!(width > 0 && height > 0)) throw new ImageFormatError(`Bad DDS size ${width}x${height}.`);
  if (flags & 0x4) {
    const blockBytes = { DXT1: 8, DXT3: 16, DXT5: 16 }[fourCC];
    if (!blockBytes) throw new ImageFormatError(`DDS format ${fourCC} is not supported.`);
    const bw = (width + 3) >> 2;
    const bh = (height + 3) >> 2;
    if (pos + bw * bh * blockBytes > bytes.length) throw new ImageFormatError("The DDS data is truncated.");
    const image = createImage(width, height);
    const p = image.pixels;
    const block = new Uint8Array(64);
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) {
        const o = pos + (by * bw + bx) * blockBytes;
        if (fourCC === "DXT1") colorBlock(bytes, view, o, block, true);
        else {
          colorBlock(bytes, view, o + 8, block, false);
          if (fourCC === "DXT3") dxt3Alpha(bytes, o, block);
          else dxt5Alpha(bytes, o, block);
        }
        for (let py = 0; py < 4; py++)
          for (let px = 0; px < 4; px++) {
            const x = bx * 4 + px;
            const y = by * 4 + py;
            if (x < width && y < height) p.set(block.subarray((py * 4 + px) * 4, (py * 4 + px) * 4 + 4), (y * width + x) * 4);
          }
      }
    return image;
  }
  if (!(flags & 0x40) || ![16, 24, 32].includes(bits)) throw new ImageFormatError("This DDS pixel format is not supported.");
  const hasAlpha = (flags & 0x1) !== 0 && am !== 0;
  const pixelBytes = bits >> 3;
  if (pos + width * height * pixelBytes > bytes.length) throw new ImageFormatError("The DDS data is truncated.");
  const image = createImage(width, height);
  const p = image.pixels;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = pos + (y * width + x) * pixelBytes;
      const v = bits === 32 ? view.getUint32(o, true) : bits === 24 ? bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) : view.getUint16(o, true);
      p.set([maskValue(v, rm), maskValue(v, gm), maskValue(v, bm), hasAlpha ? maskValue(v, am) : 255], (y * width + x) * 4);
    }
  return image;
}

function rgb565(c) {
  return [Math.round((((c >> 11) & 31) * 255) / 31), Math.round((((c >> 5) & 63) * 255) / 63), Math.round(((c & 31) * 255) / 31), 255];
}

function colorBlock(bytes, view, o, out, dxt1) {
  const c0 = view.getUint16(o, true);
  const c1 = view.getUint16(o + 2, true);
  const a = rgb565(c0);
  const b = rgb565(c1);
  const mix = (wa, wb, div) => [0, 1, 2].map((k) => Math.floor((a[k] * wa + b[k] * wb) / div)).concat(255);
  const palette = !dxt1 || c0 > c1 ? [a, b, mix(2, 1, 3), mix(1, 2, 3)] : [a, b, mix(1, 1, 2), [0, 0, 0, 0]];
  const indices = view.getUint32(o + 4, true);
  for (let i = 0; i < 16; i++) out.set(palette[(indices >>> (i * 2)) & 3], i * 4);
}

function dxt3Alpha(bytes, o, out) {
  for (let i = 0; i < 16; i++) out[i * 4 + 3] = ((bytes[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
}

function dxt5Alpha(bytes, o, out) {
  const a0 = bytes[o];
  const a1 = bytes[o + 1];
  const values = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) values.push(Math.floor(((7 - i) * a0 + i * a1) / 7));
  else {
    for (let i = 1; i < 5; i++) values.push(Math.floor(((5 - i) * a0 + i * a1) / 5));
    values.push(0, 255);
  }
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(bytes[o + 2 + i]) << BigInt(8 * i);
  for (let i = 0; i < 16; i++) out[i * 4 + 3] = values[Number((bits >> BigInt(3 * i)) & 7n)];
}
