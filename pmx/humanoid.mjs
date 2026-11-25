import { normalizeName } from "./names.mjs";

/**
 * Maps MMD's standard bone names (Japanese, plus common English ones) to VRM
 * 1.0 human bones. Ported from pmx-to-vrm's `Humanoid` (MIT).
 */

export const REQUIRED_BONES = Object.freeze([
  "hips",
  "spine",
  "head",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
]);

/** @type {[string, string[], string[]][]} */
const CENTER = [
  ["spine", ["上半身"], ["upperbody", "spine"]],
  ["chest", ["上半身2"], ["upperbody2", "chest"]],
  ["upperChest", ["上半身3"], ["upperbody3", "upperchest"]],
  ["neck", ["首"], ["neck"]],
  ["head", ["頭"], ["head"]],
];

/**
 * Side-specific bones: Japanese names take 左/右 in front, English ones l/r or
 * left/right around them. D-bones (足D, ひざD, 足首D) come first: when present
 * they carry the skin, and MMD drives the plain chain by IK.
 * @type {[string, string[], string[]][]}
 */
const SIDED = [
  ["Eye", ["目"], ["eye"]],
  ["Shoulder", ["肩"], ["shoulder"]],
  ["UpperArm", ["腕"], ["arm", "upperarm"]],
  ["LowerArm", ["ひじ", "肘"], ["elbow", "forearm", "lowerarm"]],
  ["Hand", ["手首"], ["wrist", "hand"]],
  ["UpperLeg", ["足d", "足"], ["legd", "leg", "upperleg", "thigh"]],
  ["LowerLeg", ["ひざd", "膝d", "ひざ", "膝"], ["kneed", "knee", "lowerleg", "calf"]],
  ["Foot", ["足首d", "足首"], ["ankled", "ankle", "foot"]],
  ["Toes", ["足先ex", "つま先"], ["toeex", "toe", "toes"]],
  ["ThumbMetacarpal", ["親指0"], ["thumb0"]],
  ["ThumbProximal", ["親指1"], ["thumb1"]],
  ["ThumbDistal", ["親指2"], ["thumb2"]],
  ["IndexProximal", ["人指1", "人差指1"], ["index1", "indexfinger1", "fore1"]],
  ["IndexIntermediate", ["人指2", "人差指2"], ["index2", "indexfinger2", "fore2"]],
  ["IndexDistal", ["人指3", "人差指3"], ["index3", "indexfinger3", "fore3"]],
  ["MiddleProximal", ["中指1"], ["middle1", "middlefinger1"]],
  ["MiddleIntermediate", ["中指2"], ["middle2", "middlefinger2"]],
  ["MiddleDistal", ["中指3"], ["middle3", "middlefinger3"]],
  ["RingProximal", ["薬指1"], ["ring1", "ringfinger1", "third1"]],
  ["RingIntermediate", ["薬指2"], ["ring2", "ringfinger2", "third2"]],
  ["RingDistal", ["薬指3"], ["ring3", "ringfinger3", "third3"]],
  ["LittleProximal", ["小指1"], ["little1", "littlefinger1", "pinky1"]],
  ["LittleIntermediate", ["小指2"], ["little2", "littlefinger2", "pinky2"]],
  ["LittleDistal", ["小指3"], ["little3", "littlefinger3", "pinky3"]],
];

const SIDES = [
  { side: "left", jp: "左", short: "l", long: "left" },
  { side: "right", jp: "右", short: "r", long: "right" },
];

/** For each human bone, the human bones that may be its nearest humanoid parent, preferred first. */
const PARENTS = (() => {
  /** @type {Record<string, string[]>} */
  const p = {
    spine: ["hips"],
    chest: ["spine"],
    upperChest: ["chest"],
    neck: ["upperChest", "chest", "spine"],
    head: ["neck", "upperChest", "chest", "spine"],
  };
  for (const { side: s } of SIDES) {
    p[`${s}Eye`] = ["head"];
    p[`${s}Shoulder`] = ["upperChest", "chest", "spine"];
    p[`${s}UpperArm`] = [`${s}Shoulder`, "upperChest", "chest", "spine"];
    p[`${s}LowerArm`] = [`${s}UpperArm`];
    p[`${s}Hand`] = [`${s}LowerArm`];
    p[`${s}UpperLeg`] = ["hips"];
    p[`${s}LowerLeg`] = [`${s}UpperLeg`];
    p[`${s}Foot`] = [`${s}LowerLeg`];
    p[`${s}Toes`] = [`${s}Foot`];
    p[`${s}ThumbMetacarpal`] = [`${s}Hand`];
    p[`${s}ThumbProximal`] = [`${s}ThumbMetacarpal`];
    p[`${s}ThumbDistal`] = [`${s}ThumbProximal`];
    for (const f of ["Index", "Middle", "Ring", "Little"]) {
      p[`${s}${f}Proximal`] = [`${s}Hand`];
      p[`${s}${f}Intermediate`] = [`${s}${f}Proximal`];
      p[`${s}${f}Distal`] = [`${s}${f}Intermediate`];
    }
  }
  return p;
})();

/** Every human bone this module maps, parents before children. */
export function humanBoneOrder() {
  return ["hips", ...CENTER.map(([bone]) => bone), ...SIDES.flatMap(({ side }) => SIDED.map(([bone]) => side + bone))];
}

/**
 * @param {Int32Array | number[]} parent
 * @param {number} bone
 * @param {number} ancestor
 */
export function isDescendant(parent, bone, ancestor) {
  let guard = 0;
  for (let p = parent[bone]; p >= 0 && guard++ < 1e6; p = parent[p]) if (p === ancestor) return true;
  return false;
}

function commonAncestor(parent, bones) {
  /** @type {Set<number> | null} */
  let common = null;
  for (const bone of bones) {
    const chain = new Set();
    for (let p = parent[bone]; p >= 0 && !chain.has(p); p = parent[p]) chain.add(p);
    common = common ? new Set([...common].filter((b) => chain.has(b))) : chain;
  }
  if (!common || common.size === 0) return -1;
  for (let p = parent[bones[0]]; p >= 0; p = parent[p]) if (common.has(p)) return p;
  return -1;
}

/**
 * Map the model's bones to VRM human bones.
 * @param {import("./reader.mjs").PmxModel} model
 * @param {Int32Array} parent Parent per bone, -1 for roots, cycles already cut.
 * @param {boolean[]} excluded Bones that may not be human bones (simulated by physics).
 * @param {string[]} warnings
 * @returns {Map<string, number>}
 */
export function mapHumanoid(model, parent, excluded, warnings) {
  /** @type {Map<string, number>} */
  const jp = new Map();
  /** @type {Map<string, number>} */
  const en = new Map();
  const first = (map, key, index) => {
    if (key && !map.has(key)) map.set(key, index);
  };
  model.bones.forEach((bone, i) => {
    if (excluded[i]) return;
    first(jp, normalizeName(bone.name), i);
    first(en, normalizeName(bone.nameEn), i);
    // Some models fill only the local name, with an English name.
    first(en, normalizeName(bone.name), i);
  });

  /** @type {Map<string, number>} */
  const map = new Map();
  const used = new Set();
  const find = (jpNames, enNames) => {
    for (const name of jpNames) {
      const i = jp.get(name);
      if (i !== undefined && !used.has(i)) return i;
    }
    for (const name of enNames) {
      const i = en.get(name);
      if (i !== undefined && !used.has(i)) return i;
    }
    return -1;
  };
  const put = (bone, i) => {
    if (i < 0) return;
    map.set(bone, i);
    used.add(i);
  };

  for (const [bone, jpNames, enNames] of CENTER) put(bone, find(jpNames.map(normalizeName), enNames));
  for (const { side, jp: jpSide, short, long } of SIDES)
    for (const [bone, jpNames, enNames] of SIDED) {
      const english = enNames.flatMap((e) => [e + short, long + e, short + e, e + long]);
      put(side + bone, find(jpNames.map((name) => normalizeName(jpSide + name)), english));
    }

  // Older models have no 親指０: their 親指１/２ are the first two thumb bones.
  for (const { side } of SIDES) {
    const proximal = map.get(`${side}ThumbProximal`);
    if (!map.has(`${side}ThumbMetacarpal`) && proximal !== undefined) {
      map.set(`${side}ThumbMetacarpal`, proximal);
      map.delete(`${side}ThumbProximal`);
      const distal = map.get(`${side}ThumbDistal`);
      if (distal !== undefined) {
        map.set(`${side}ThumbProximal`, distal);
        map.delete(`${side}ThumbDistal`);
      }
    }
  }

  // Hips: the deepest common ancestor of the spine and both upper legs (センター, グルーブ or 腰).
  const spine = map.get("spine");
  const leftLeg = map.get("leftUpperLeg");
  const rightLeg = map.get("rightUpperLeg");
  if (spine !== undefined && leftLeg !== undefined && rightLeg !== undefined) {
    const hips = commonAncestor(parent, [spine, leftLeg, rightLeg]);
    if (hips >= 0 && !used.has(hips) && !excluded[hips]) put("hips", hips);
  }
  if (!map.has("hips"))
    put("hips", find(["下半身", "腰", "センター"].map(normalizeName), ["hips", "lowerbody", "center", "waist"]));

  // Every human bone must sit below its humanoid parent; drop those that don't.
  for (const bone of humanBoneOrder()) {
    const index = map.get(bone);
    if (index === undefined || bone === "hips") continue;
    const parents = PARENTS[bone];
    if (!parents) continue;
    const expected = parents.find((p) => map.has(p));
    if (expected === undefined || !isDescendant(parent, index, /** @type {number} */ (map.get(expected)))) {
      warnings.push(
        `Bone '${model.bones[index].name}' looks like ${bone} but is not below ${expected ?? parents.join("/")}; left out of the humanoid.`,
      );
      map.delete(bone);
    }
  }
  return map;
}

/**
 * Bones that stand for a mapped human bone without being it: the plain
 * 足/ひざ/足首/つま先 chain when the D-bones were mapped (MMD moves it by IK;
 * in VRM it never moves), and other name variants. Rigid bodies on them belong
 * on the human bone.
 * @param {import("./reader.mjs").PmxModel} model
 * @param {Map<string, number>} map
 * @returns {Map<number, string>}
 */
export function humanBoneAliases(model, map) {
  /** @type {Map<string, number>} */
  const byName = new Map();
  model.bones.forEach((bone, i) => {
    const key = normalizeName(bone.name);
    if (!byName.has(key)) byName.set(key, i);
  });
  const mapped = new Set(map.values());
  /** @type {Map<number, string>} */
  const result = new Map();
  for (const { side, jp: jpSide } of SIDES)
    for (const [bone, jpNames] of SIDED) {
      if (!map.has(side + bone)) continue;
      for (const name of jpNames) {
        const i = byName.get(normalizeName(jpSide + name));
        if (i !== undefined && !mapped.has(i) && !result.has(i)) result.set(i, side + bone);
      }
    }
  return result;
}

/**
 * The collider and spring region of a human bone.
 * @param {string} humanBone
 * @returns {"Head" | "Body" | "LeftArm" | "RightArm" | "LeftLeg" | "RightLeg"}
 */
export function humanBoneRegion(humanBone) {
  if (["head", "neck", "leftEye", "rightEye", "jaw"].includes(humanBone)) return "Head";
  const leg = /Leg|Foot|Toes/.test(humanBone);
  if (humanBone.startsWith("left") && leg) return "LeftLeg";
  if (humanBone.startsWith("right") && leg) return "RightLeg";
  if (humanBone.startsWith("left") && !humanBone.includes("Shoulder")) return "LeftArm";
  if (humanBone.startsWith("right") && !humanBone.includes("Shoulder")) return "RightArm";
  return "Body";
}
