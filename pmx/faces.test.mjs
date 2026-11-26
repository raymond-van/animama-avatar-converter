import assert from "node:assert/strict";
import { test } from "node:test";
import { composeFace, mirrorName, moodOf, parseExpressionOverride, regionOfName, regionOfPanel } from "./faces.mjs";
import { normalizeName } from "./names.mjs";

/** Face morphs as composeFace takes them, one per name, with a region and a side. */
function morphs(entries) {
  return entries.map(([name, region = null, sideX = NaN], target) => ({ target, name, key: normalizeName(name), region, sideX }));
}
const named = (list, binds) => binds?.map(({ target, weight }) => (weight === 1 ? list[target].name : `${list[target].name}*${weight}`));

test("composes MMD's standard morphs into presets and per-region parts", () => {
  const list = morphs([
    ["あ"], ["い"], ["う"], ["え"], ["お"], ["まばたき"], ["ウィンク", "EYE", 0.5], ["ウィンク右", "EYE", -0.5],
    ["にこり", "BRW"], ["笑い", "EYE"], ["にっこり", "MTH"], ["なごみ", "EYE"], ["困る", "BRW"], ["怒り", "BRW"],
    ["じと目", "EYE"], ["上", "BRW"], ["びっくり", "EYE"], ["口角下げ", "MTH"], ["∧", "MTH"],
  ]);
  const { presets, parts } = composeFace(list, () => {});
  assert.deepEqual(named(list, presets.aa), ["あ"]);
  assert.deepEqual(named(list, presets.blink), ["まばたき"]);
  assert.deepEqual(named(list, presets.blinkLeft), ["ウィンク"]);
  assert.deepEqual(named(list, presets.blinkRight), ["ウィンク右"]);
  assert.deepEqual(named(list, presets.happy), ["にこり", "笑い", "にっこり"]);
  assert.deepEqual(named(list, presets.relaxed), ["にこり", "なごみ", "にっこり"]);
  // Sad and angry fill the regions MMD's standard set leaves empty with the closest morphs.
  assert.deepEqual(named(list, presets.sad), ["困る", "じと目*0.5", "口角下げ"]);
  assert.deepEqual(named(list, presets.angry), ["怒り", "じと目", "∧"]);
  assert.deepEqual(named(list, presets.surprised), ["上", "びっくり", "お"]);
  assert.deepEqual(named(list, parts.Fcl_EYE_Sorrow), ["じと目*0.5"]);
  assert.deepEqual(named(list, parts.Fcl_ALL_Joy), ["にこり", "笑い", "にっこり"]);
});

test("translates English, Chinese and Korean names, placing mood-only names by their region", () => {
  const list = morphs([
    ["a"], ["blink"], ["wink_L", null, 0.5], ["wink_R", null, -0.5],
    ["smile", "EYE"], ["grin_happy", "MTH"], ["brow_angry"], ["生气", "EYE"], ["难过", "MTH"], ["슬픔", "BRW"], ["surprised", "EYE"], ["mouth_surprised"],
  ]);
  const { presets, parts } = composeFace(list, () => {});
  assert.deepEqual(named(list, presets.aa), ["a"]);
  assert.deepEqual(named(list, presets.blink), ["blink"]);
  assert.deepEqual(named(list, presets.blinkLeft), ["wink_L"]);
  assert.deepEqual(named(list, presets.blinkRight), ["wink_R"]);
  assert.deepEqual(named(list, parts.Fcl_EYE_Joy), ["smile"]);
  assert.deepEqual(named(list, parts.Fcl_MTH_Joy), ["grin_happy"], "a mood-only name on the mouth panel");
  assert.deepEqual(named(list, parts.Fcl_EYE_Surprised), ["surprised"]);
  assert.deepEqual(named(list, parts.Fcl_MTH_Surprised), ["mouth_surprised"], "the region from the name");
  assert.deepEqual(named(list, parts.Fcl_BRW_Angry), ["brow_angry"]);
  assert.deepEqual(named(list, parts.Fcl_EYE_Angry), ["生气"]);
  assert.deepEqual(named(list, parts.Fcl_MTH_Sorrow), ["难过"]);
  assert.deepEqual(named(list, parts.Fcl_BRW_Sorrow), ["슬픔"]);
  assert.equal(parts.Fcl_BRW_Joy, undefined, "nothing smiles on the brows: neutral");
});

test("a model made from VRoid keeps its own parts, and a whole-face morph takes no region", () => {
  // As heights or panels would place them: the whole face reads as eyes, the brows as eyes too.
  const list = morphs([["Fcl_ALL_Joy", "ALL"], ["Fcl_BRW_Joy", "EYE"], ["Fcl_EYE_Joy", "EYE"], ["Fcl_MTH_Joy", "MTH"], ["悲しみ", "ALL"], ["困る", "BRW"]]);
  const { presets, parts } = composeFace(list, () => {});
  assert.deepEqual(named(list, parts.Fcl_BRW_Joy), ["Fcl_BRW_Joy"]);
  assert.deepEqual(named(list, parts.Fcl_EYE_Joy), ["Fcl_EYE_Joy"]);
  assert.deepEqual(named(list, parts.Fcl_MTH_Joy), ["Fcl_MTH_Joy"]);
  assert.deepEqual(named(list, presets.happy), ["Fcl_ALL_Joy"], "VRoid's preset plays its whole-face morph");
  assert.deepEqual(named(list, parts.Fcl_ALL_Joy), ["Fcl_ALL_Joy"]);
  // 悲しみ states sorrow but moves the whole face: it fills no region, so the brows alone play sad.
  assert.deepEqual(named(list, presets.sad), ["困る"]);
  assert.equal(parts.Fcl_EYE_Sorrow, undefined);
});

test("a one-sided mood morph plays with its other side", () => {
  const list = morphs([["eye_sad_geo_L", "EYE"], ["eye_sad_geo_R", "EYE"], ["brow_sadLeft", "BRW"], ["brow_sadRight", "BRW"], ["mouth_sad_geo_C", "MTH"]]);
  const { parts } = composeFace(list, () => {});
  assert.deepEqual(named(list, parts.Fcl_EYE_Sorrow), ["eye_sad_geo_L", "eye_sad_geo_R"]);
  assert.deepEqual(named(list, parts.Fcl_BRW_Sorrow), ["brow_sadLeft", "brow_sadRight"]);
  assert.deepEqual(named(list, parts.Fcl_MTH_Sorrow), ["mouth_sad_geo_C"], "a centre morph has no partner");
  assert.equal(mirrorName("eye_sad_geo_L"), "eye_sad_geo_R");
  assert.equal(mirrorName("eyeSquintRight"), "eyeSquintLeft");
  assert.equal(mirrorName("笑い左"), "笑い右");
  assert.equal(mirrorName("右笑い"), "左笑い");
  assert.equal(mirrorName("mouth_sad_geo_C"), null);
  assert.equal(mirrorName("Bright"), null, "not a side, only a word ending in right");
  assert.equal(mirrorName("bright"), null);
  assert.equal(mirrorName("mouth_upright"), null);
  assert.equal(mirrorName("brow.right"), "brow.left");
});

test("a region with no named morph takes Animama's ARKit mix when the model has every shape of it", () => {
  const shapes = ["eyeBlinkLeft", "eyeBlinkRight", "eyeSquintLeft", "eyeSquintRight", "cheekSquintLeft", "cheekSquintRight", "mouthSmileLeft", "mouthSmileRight"];
  const list = morphs([["にっこり", "MTH"], ...shapes.map((name) => [name])]);
  const { parts } = composeFace(list, () => {});
  // Relaxed eyes: no なごみ or other relaxed eye morph, so the ARKit mix, at its weights.
  assert.deepEqual(named(list, parts.Fcl_EYE_Fun), ["eyeBlinkLeft*0.15", "eyeBlinkRight*0.15", "eyeSquintLeft*0.5", "eyeSquintRight*0.5", "cheekSquintLeft*0.5", "cheekSquintRight*0.5"]);
  assert.deepEqual(named(list, parts.Fcl_MTH_Fun), ["にっこり"], "a named morph comes first");
  // Relaxed brows need shapes the model lacks: neutral, not a partial mix.
  assert.equal(parts.Fcl_BRW_Fun, undefined);
});

test("ARKit shapes never pass for mood morphs by their names (mouthFunnel is no fun)", () => {
  const shapes = ["mouthFunnel", "mouthSmileLeft", "mouthSmileRight", "jawOpen"];
  const list = morphs(shapes.map((name) => [name, "MTH"]));
  const { parts } = composeFace(list, () => {});
  assert.deepEqual(named(list, parts.Fcl_MTH_Fun), ["mouthSmileLeft", "mouthSmileRight"], "Animama's relaxed mouth mix");
  assert.deepEqual(named(list, parts.Fcl_MTH_Joy), ["mouthSmileLeft", "mouthSmileRight", "jawOpen*0.15"]);
});

test("judges a wink's side from the vertices it moves, not its name", () => {
  const warnings = [];
  // Named left, but it closes the model's right eye (−X), and vice versa.
  const list = morphs([["ウィンク", "EYE", -0.5], ["ウィンク右", "EYE", 0.5]]);
  const { presets } = composeFace(list, (w) => warnings.push(w));
  assert.deepEqual(named(list, presets.blinkLeft), ["ウィンク右"]);
  assert.deepEqual(named(list, presets.blinkRight), ["ウィンク"]);
  assert.equal(warnings.length, 2);
  // Both winks alone, without まばたき, make the blink.
  assert.deepEqual(named(list, presets.blink).sort(), ["ウィンク", "ウィンク右"].sort());
});

test("reads regions from names and panels and moods from names", () => {
  assert.equal(regionOfName(normalizeName("eyebrow_up")), "BRW");
  assert.equal(regionOfName(normalizeName("眉毛")), "BRW");
  assert.equal(regionOfName(normalizeName("mouth_smile")), "MTH");
  assert.equal(regionOfName(normalizeName("笑眼")), "EYE");
  assert.equal(regionOfName(normalizeName("smile")), null);
  assert.deepEqual([1, 2, 3, 4].map(regionOfPanel), ["BRW", "EYE", "MTH", null]);
  assert.equal(moodOf(normalizeName("Happy")), "Joy");
  assert.equal(moodOf(normalizeName("惊讶")), "Surprised");
  assert.equal(moodOf(normalizeName("sad_smile")), null, "two moods name none");
});

test("parses --expression overrides", () => {
  assert.deepEqual(parseExpressionOverride("happy=笑い+にっこり*0.5"), {
    name: "happy",
    morphs: [
      { morph: "笑い", weight: 1 },
      { morph: "にっこり", weight: 0.5 },
    ],
  });
  assert.deepEqual(parseExpressionOverride("sad="), { name: "sad", morphs: [] });
  assert.throws(() => parseExpressionOverride("happy"), /needs <name>=<morph>/);
  assert.throws(() => parseExpressionOverride("happy=あ*2"), /between 0 and 1/);
  assert.throws(() => parseExpressionOverride("happy=あ*"), /between 0 and 1/, "an empty weight is not 0");
  assert.throws(() => parseExpressionOverride("joy=あ"), /not a preset or part/);
  assert.throws(() => parseExpressionOverride("Fcl_ALL_Joy=あ"), /not a preset or part/);
  assert.throws(() => parseExpressionOverride("blink="), /can't leave a blink or vowel empty/);
  assert.throws(() => parseExpressionOverride("aa="), /can't leave a blink or vowel empty/);
  assert.throws(() => parseExpressionOverride("aa=あ*0"), /can't leave a blink or vowel empty/, "a weight of 0 is empty too");
  assert.deepEqual(parseExpressionOverride("Fcl_EYE_Joy="), { name: "Fcl_EYE_Joy", morphs: [] }, "a mood region may be neutral");
});
