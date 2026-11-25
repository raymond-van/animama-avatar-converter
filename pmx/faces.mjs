import { normalizeName } from "./names.mjs";

/**
 * Which face morph means what. MMD models name their face morphs by an
 * informal standard (あ, まばたき, 笑い, 困る …), which Animama's MMD face table
 * also reads; others use English, Chinese or Korean names. This module
 * recognises a morph's meaning from its name, its region (brows, eyes, mouth)
 * from its PMX panel or the vertices it moves, and composes VRM presets and
 * Animama's per-region parts from the model's own morphs.
 */

/** @typedef {"BRW" | "EYE" | "MTH"} Region */
/** @typedef {"Joy" | "Fun" | "Sorrow" | "Angry" | "Surprised"} Mood */

export const MOODS = /** @type {const} */ (["Joy", "Fun", "Sorrow", "Angry", "Surprised"]);
export const REGIONS = /** @type {const} */ (["BRW", "EYE", "MTH"]);

/** The VRM preset for each mood, as Animama's VRoid vocabulary pairs them. */
export const MOOD_PRESETS = /** @type {const} */ ({ Joy: "happy", Fun: "relaxed", Sorrow: "sad", Angry: "angry", Surprised: "surprised" });

/** Presets and parts that may be overridden from the command line (`--expression`). */
export const OVERRIDABLE = [
  "aa",
  "ih",
  "ou",
  "ee",
  "oh",
  "blink",
  "blinkLeft",
  "blinkRight",
  ...Object.values(MOOD_PRESETS),
  ...MOODS.flatMap((mood) => REGIONS.map((region) => `Fcl_${region}_${mood}`)),
];

/** Names for one meaning, in any language; matched after normalizeName. */
const alias = (...names) => names.map(normalizeName);

/** Visemes and blinks: exact meanings, region implied. */
export const FIXED_MEANINGS = {
  aa: alias("あ", "a", "aa", "mouth_a", "vrc.v_aa", "啊", "아"),
  ih: alias("い", "i", "ih", "mouth_i", "vrc.v_ih", "咿", "이"),
  ou: alias("う", "u", "ou", "mouth_u", "vrc.v_ou", "呜", "우"),
  ee: alias("え", "e", "ee", "mouth_e", "vrc.v_e", "诶", "에"),
  oh: alias("お", "o", "oh", "mouth_o", "vrc.v_oh", "哦", "오"),
  blink: alias("まばたき", "瞬き", "blink", "blink_both", "eye_close", "close_eyes", "眨眼", "闭眼", "閉眼", "눈감기"),
  // Plain closed eyes first: MMD's ウィンク２ closes the eye flatly, ウィンク smiles.
  blinkLeft: alias("ウィンク２", "ウィンク", "wink2", "wink", "wink_l", "wink_left", "blink_l", "blink_left", "左眨眼", "左闭眼", "왼쪽윙크"),
  blinkRight: alias("ウィンク２右", "ウィンク右", "wink2_r", "wink_r", "wink_right", "blink_r", "blink_right", "右眨眼", "右闭眼", "오른쪽윙크"),
};

/**
 * Per mood and region: the morphs that play it, best first. Each entry is a
 * standard MMD name (Animama's MMD face table uses the first of each region
 * where it has one) or a fallback with a weight. A model's morph matches an
 * entry by name; a morph named only by mood ("smile", "生气") also matches
 * the region its panel or vertices place it in (see `moodOf`).
 * @type {Record<Mood, Record<Region, {name: string, weight?: number}[]>>}
 */
export const MOOD_CHOICES = {
  Joy: {
    BRW: [{ name: "にこり" }],
    EYE: [{ name: "笑い" }],
    MTH: [{ name: "にっこり" }, { name: "口角上げ" }, { name: "ワ" }, { name: "ω" }, { name: "にやり" }],
  },
  Fun: {
    BRW: [{ name: "にこり" }],
    EYE: [{ name: "なごみ" }],
    MTH: [{ name: "にっこり" }, { name: "口角上げ" }, { name: "ω" }],
  },
  Sorrow: {
    BRW: [{ name: "困る" }],
    EYE: [{ name: "悲しい" }, { name: "悲しむ" }, { name: "哀しい" }, { name: "泣き" }, { name: "じと目", weight: 0.5 }],
    MTH: [{ name: "口角下げ" }, { name: "∧" }],
  },
  Angry: {
    BRW: [{ name: "怒り" }],
    EYE: [{ name: "じと目" }, { name: "ｷﾘｯ" }, { name: "キリッ" }],
    MTH: [{ name: "∧" }, { name: "口角下げ" }, { name: "口横狭め" }],
  },
  Surprised: {
    BRW: [{ name: "上" }],
    EYE: [{ name: "びっくり" }],
    MTH: [{ name: "お" }, { name: "ワ" }, { name: "□" }, { name: "あ", weight: 0.5 }],
  },
};

/** Words that name a region inside a morph name. */
const REGION_WORDS = {
  BRW: ["brow", "eyebrow", "brw", "まゆ", "眉", "눈썹"],
  EYE: ["eye", "目", "眼", "눈"],
  MTH: ["mouth", "mth", "lip", "口", "嘴", "입"],
};

/** Words that name a mood inside a morph name. */
const MOOD_WORDS = {
  Joy: ["smile", "happy", "joy", "laugh", "笑", "喜", "嬉", "开心", "高兴", "웃", "기쁨"],
  Fun: ["relax", "calm", "fun", "なごみ", "柔和", "편안"],
  Sorrow: ["sad", "sorrow", "cry", "troubl", "悲", "哀", "泣", "难过", "伤心", "슬"],
  Angry: ["angry", "anger", "mad", "怒", "生气", "愤", "화"],
  Surprised: ["surpris", "shock", "驚", "惊", "吃惊", "놀"],
};

/**
 * The region a name states, or null. Brow words are tried before eye words,
 * since "eyebrow" and 眉 contain both.
 * @param {string} key A normalized name.
 * @returns {Region | null}
 */
export function regionOfName(key) {
  for (const region of /** @type {Region[]} */ (["BRW", "MTH", "EYE"]))
    if (REGION_WORDS[region].some((word) => key.includes(normalizeName(word)))) return region;
  return null;
}

/**
 * The mood a name states, or null when it states none or several.
 * @param {string} key A normalized name.
 * @returns {Mood | null}
 */
export function moodOf(key) {
  const found = MOODS.filter((mood) => MOOD_WORDS[mood].some((word) => key.includes(normalizeName(word))));
  return found.length === 1 ? found[0] : null;
}

/**
 * The region a PMX panel names (1 brow, 2 eye, 3 mouth), or null.
 * @param {number} panel
 * @returns {Region | null}
 */
export function regionOfPanel(panel) {
  return panel === 1 ? "BRW" : panel === 2 ? "EYE" : panel === 3 ? "MTH" : null;
}

/**
 * @typedef {object} FaceMorph
 * @property {number} target Morph-target index.
 * @property {string} name The target's (PMX) name.
 * @property {string} key Its normalized name.
 * @property {Region | "ALL" | null} region From the name, else the panel, else the vertices; "ALL" for a
 *   morph that moves the whole face (named so, or moving more than one region), which no region slot takes.
 * @property {number} sideX Weighted mean x of the moved vertices (the model's left is +X), or NaN.
 */

/** @typedef {{target: number, weight: number}} Bind */

/**
 * Compose the presets and per-region parts from the model's face morphs.
 * @param {FaceMorph[]} morphs
 * @param {(warning: string) => void} warn
 * @returns {{presets: Record<string, Bind[]>, parts: Record<string, Bind[]>}}
 */
export function composeFace(morphs, warn) {
  /** @type {Map<string, FaceMorph>} */
  const byKey = new Map();
  for (const morph of morphs) if (!byKey.has(morph.key)) byKey.set(morph.key, morph);
  const exact = (names) => {
    for (const name of names) {
      const morph = byKey.get(name);
      if (morph) return morph;
    }
    return null;
  };

  /** @type {Record<string, Bind[]>} */
  const presets = {};
  for (const preset of ["aa", "ih", "ou", "ee", "oh"]) {
    const morph = exact(FIXED_MEANINGS[preset]);
    if (morph) presets[preset] = [{ target: morph.target, weight: 1 }];
  }

  // Winks: the candidates by name, then the side each closes, from its vertices.
  const left = exact(FIXED_MEANINGS.blinkLeft);
  const right = exact(FIXED_MEANINGS.blinkRight);
  for (const [morph, named] of [
    [left, "blinkLeft"],
    [right, "blinkRight"],
  ]) {
    if (!morph || (named === "blinkRight" && morph === left)) continue;
    const side = Number.isNaN(morph.sideX) ? named : morph.sideX > 0 ? "blinkLeft" : "blinkRight";
    if (presets[side]) {
      warn(`'${morph.name}' closes the same eye as '${morphs.find((m) => m.target === presets[side][0].target)?.name}'; not used as ${side}.`);
      continue;
    }
    if (side !== named) warn(`'${morph.name}' closes the model's ${side === "blinkLeft" ? "left" : "right"} eye (judged from its vertices); used as ${side}.`);
    presets[side] = [{ target: morph.target, weight: 1 }];
  }
  const blink = exact(FIXED_MEANINGS.blink);
  if (blink) presets.blink = [{ target: blink.target, weight: 1 }];
  else if (presets.blinkLeft && presets.blinkRight) presets.blink = [...presets.blinkLeft, ...presets.blinkRight];

  /** @type {Record<string, Bind[]>} */
  const parts = {};
  for (const mood of MOODS) {
    /** @type {Bind[]} */
    const whole = [];
    for (const region of REGIONS) {
      const bind = chooseRegion(mood, region, morphs, byKey);
      if (!bind) continue;
      parts[`Fcl_${region}_${mood}`] = [bind];
      whole.push(bind);
    }
    // A model with VRoid's own whole-face morph (a PMX made from a VRoid model) keeps it,
    // as VRoid's preset does, rather than a sum of the parts that may differ from it.
    const own = byKey.get(normalizeName(`Fcl_ALL_${mood}`));
    if (own) whole.splice(0, whole.length, { target: own.target, weight: 1 });
    if (whole.length > 0) {
      presets[MOOD_PRESETS[mood]] = mergeBinds(whole);
      parts[`Fcl_ALL_${mood}`] = mergeBinds(whole);
    }
  }
  return { presets, parts };
}

/**
 * The morph that plays one mood in one region: VRoid's own part of that name,
 * a standard MMD name, then a morph whose name states that mood in that
 * region (never one that moves the whole face), then the fallbacks.
 * @param {Mood} mood
 * @param {Region} region
 * @param {FaceMorph[]} morphs
 * @param {Map<string, FaceMorph>} byKey
 * @returns {Bind | null}
 */
function chooseRegion(mood, region, morphs, byKey) {
  const vroid = byKey.get(normalizeName(`Fcl_${region}_${mood}`));
  if (vroid) return { target: vroid.target, weight: 1 };
  const [standard, ...fallbacks] = MOOD_CHOICES[mood][region];
  const named = byKey.get(normalizeName(standard.name));
  if (named) return { target: named.target, weight: standard.weight ?? 1 };
  const stated = morphs.find((morph) => (morph.region ?? regionOfName(morph.key)) === region && moodOf(morph.key) === mood);
  if (stated) return { target: stated.target, weight: 1 };
  for (const choice of fallbacks) {
    const morph = byKey.get(normalizeName(choice.name));
    if (morph) return { target: morph.target, weight: choice.weight ?? 1 };
  }
  return null;
}

/** Binds with each target once, at its largest weight. @param {Bind[]} binds */
export function mergeBinds(binds) {
  /** @type {Map<number, number>} */
  const weights = new Map();
  for (const { target, weight } of binds) weights.set(target, Math.max(weights.get(target) ?? 0, weight));
  return [...weights].map(([target, weight]) => ({ target, weight }));
}

/**
 * Parse an --expression override: `<name>=<morph>[*<weight>][+<morph>[*<weight>]…]`.
 * @param {string} text
 * @returns {{name: string, morphs: {morph: string, weight: number}[]}}
 */
export function parseExpressionOverride(text) {
  const at = text.indexOf("=");
  if (at <= 0) throw new Error(`--expression needs <name>=<morph>[*weight][+<morph>…], not "${text}".`);
  const name = text.slice(0, at).trim();
  if (!OVERRIDABLE.includes(name))
    throw new Error(`--expression: "${name}" is not a preset or part that can be overridden (${OVERRIDABLE.slice(0, 13).join(", ")}, Fcl_<BRW|EYE|MTH>_<Mood>).`);
  const morphs = text
    .slice(at + 1)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const star = part.lastIndexOf("*");
      const written = star > 0 ? part.slice(star + 1).trim() : "1";
      const weight = written === "" ? NaN : Number(written);
      if (!(weight >= 0 && weight <= 1)) throw new Error(`--expression ${name}: the weight in "${part}" must be between 0 and 1.`);
      return { morph: (star > 0 ? part.slice(0, star) : part).trim(), weight };
    });
  // Animama fills an empty blink or vowel from the model's standard morphs, so it could not stay still.
  if (morphs.every((m) => m.weight === 0) && ["aa", "ih", "ou", "ee", "oh", "blink", "blinkLeft", "blinkRight"].includes(name))
    throw new Error(`--expression ${name}= can't leave a blink or vowel empty: Animama would fill it from the model's standard morphs. Name the morphs it should play.`);
  return { name, morphs };
}
