import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { alphaUsage, decodeImage, detectImageKind, encodePng } from "./images.mjs";

/**
 * The model's textures, resolved relative to the `.pmx` and read on first
 * use. PMX paths often use backslashes, Japanese or Chinese names and a case
 * that differs from the file on disk, so each path segment is matched
 * ignoring case.
 */

/**
 * @typedef {object} TextureFile
 * @property {string} stored The path as the PMX stores it.
 * @property {string | null} file The resolved file, or null when missing.
 * @property {string | null} problem Why it cannot be used, or null; set as it is read.
 * @property {() => {bytes: Uint8Array, mimeType: "image/png" | "image/jpeg"} | null} embedded
 *   The image to embed: PNG and JPEG as they are, other formats re-encoded as
 *   PNG. Read on first use and cached; null when unusable.
 * @property {() => import("./images.mjs").RgbaImage | null} pixels Decoded RGBA,
 *   decoded on each call and not kept; null for JPEG and unusable files.
 * @property {() => "opaque" | "cutout" | "blend"} alpha How the image uses alpha
 *   (see `alphaUsage`); computed once.
 */

/**
 * Resolve a stored texture path inside `baseDir`, ignoring case and either
 * separator. A texture may sit at most one folder above the model (some
 * models share textures that way), never higher. Absolute, drive and UNC
 * paths are never followed: their file name is looked up in the model's
 * folder instead, so a model cannot make the converter read, and embed, any
 * file on the computer or reach a network share.
 * @param {string} baseDir
 * @param {string} stored
 * @param {Map<string, string[]>} listings Directory listings cache.
 * @returns {string | null}
 */
export function resolveTexturePath(baseDir, stored, listings = new Map()) {
  const cleaned = stored.trim().replace(/\\/g, "/");
  const rooted = cleaned.startsWith("/") || /^[a-z]:/i.test(cleaned);
  const parts = rooted ? [cleaned.split("/").pop() ?? ""] : cleaned.split("/");
  const segments = parts.filter((s) => s && s !== ".");
  if (segments.length === 0) return null;
  let home = path.resolve(baseDir);
  try {
    // Walk from the real folder, so a model folder reached through a link resolves like any other.
    home = realpathSync(home);
  } catch {
    // A missing folder has no textures; the walk below finds nothing.
  }
  const limit = path.dirname(home);
  let current = home;
  for (const segment of segments) {
    if (segment === "..") {
      current = path.dirname(current);
      if (!isInside(limit, current)) return null;
      continue;
    }
    if (/[:]/.test(segment)) return null;
    if (existsExactly(current, segment, listings)) {
      current = path.join(current, segment);
      continue;
    }
    const lower = segment.normalize("NFC").toLowerCase();
    const match = list(current, listings).find((entry) => entry.normalize("NFC").toLowerCase() === lower);
    if (!match) return null;
    current = path.join(current, match);
  }
  try {
    if (!statSync(current).isFile()) return null;
    // A link inside the folder must not lead out of it either.
    return isInside(realpathSync(limit), realpathSync(current)) ? current : null;
  } catch {
    return null;
  }
}

/** Whether `file` is `root` or inside it. */
function isInside(root, file) {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function list(dir, listings) {
  let entries = listings.get(dir);
  if (!entries) {
    try {
      entries = readdirSync(dir);
    } catch {
      entries = [];
    }
    listings.set(dir, entries);
  }
  return entries;
}

function existsExactly(dir, name, listings) {
  return list(dir, listings).includes(name);
}

/**
 * The model's texture table. Nothing is read until a material uses a
 * texture; each file is read once, however many entries name it, and decoded
 * pixels are not kept.
 * @param {string[]} stored The PMX texture paths.
 * @param {string} baseDir The `.pmx`'s folder.
 * @returns {TextureFile[]}
 */
export function loadTextures(stored, baseDir) {
  const listings = new Map();
  /** @type {Map<string, ReturnType<typeof imageFile>>} */
  const files = new Map();
  return stored.map((entry) => {
    const file = resolveTexturePath(baseDir, entry, listings);
    let image = file ? files.get(file) : undefined;
    if (file && !image) {
      image = imageFile(file);
      files.set(file, image);
    }
    return {
      stored: entry,
      file,
      get problem() {
        return image ? image.problem : "not found";
      },
      embedded: () => image?.embedded() ?? null,
      pixels: () => image?.pixels() ?? null,
      alpha: () => image?.alpha() ?? "opaque",
    };
  });
}

/** One image file, read on first use. @param {string} file */
function imageFile(file) {
  /** @type {Uint8Array | null | undefined} */
  let bytes;
  /** @type {import("./images.mjs").ImageKind} */
  let kind = "unknown";
  /** @type {{bytes: Uint8Array, mimeType: "image/png" | "image/jpeg"} | null | undefined} */
  let embed;
  /** @type {"opaque" | "cutout" | "blend" | undefined} */
  let alpha;
  const image = {
    /** @type {string | null} */
    problem: null,
    read() {
      if (bytes === undefined) {
        bytes = null;
        try {
          bytes = new Uint8Array(readFileSync(file));
          kind = detectImageKind(bytes, file);
        } catch (error) {
          image.problem = `unreadable (${error.code ?? error.message})`;
        }
      }
      return bytes;
    },
    /** @returns {import("./images.mjs").RgbaImage | null} */
    pixels() {
      const raw = image.read();
      if (!raw || kind === "jpeg") return null;
      try {
        const decoded = decodeImage(raw, kind);
        if (!decoded) image.problem = kind === "gif" ? "GIF is not supported" : "unknown image format";
        return decoded;
      } catch (error) {
        image.problem = `unreadable (${error.message})`;
        return null;
      }
    },
    alpha() {
      if (alpha === undefined) {
        const pixels = image.pixels();
        alpha = pixels ? alphaUsage(pixels) : "opaque";
      }
      return alpha;
    },
    embedded() {
      if (embed === undefined) {
        const raw = image.read();
        if (!raw) embed = null;
        else if (kind === "png") embed = { bytes: raw, mimeType: "image/png" };
        else if (kind === "jpeg") embed = { bytes: raw, mimeType: "image/jpeg" };
        else {
          const pixels = image.pixels();
          embed = pixels ? { bytes: encodePng(pixels), mimeType: "image/png" } : null;
        }
      }
      return embed;
    },
  };
  return image;
}
