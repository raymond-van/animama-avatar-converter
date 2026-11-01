import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "./args.mjs";

test("the prefab can be the one positional argument, and nothing is required", () => {
  assert.deepEqual(parseArgs(["Avatar", "--keep-pose"]), {
    options: { prefab: "Avatar" },
    flags: { help: false, keepPose: true, validate: false },
  });
  assert.deepEqual(parseArgs([]).options, {});
  assert.deepEqual(
    parseArgs([
      "--project",
      "P",
      "--prefab",
      "Assets/A.prefab",
      "--out",
      "A.vrm",
      "--name",
      "A",
    ]).options,
    { project: "P", prefab: "Assets/A.prefab", out: "A.vrm", name: "A" },
  );
});

test("unknown options, a second positional argument and a bad --out are errors", () => {
  assert.throws(
    () => parseArgs(["A", "--no-optimize"]),
    /Unknown option --no-optimize/,
  );
  assert.throws(() => parseArgs(["A", "B"]), /Unexpected argument B/);
  assert.throws(
    () => parseArgs(["--prefab", "A", "B"]),
    /Unexpected argument B/,
  );
  assert.throws(
    () => parseArgs(["--project", "--prefab"]),
    /--project needs a value/,
  );
  assert.throws(() => parseArgs(["A", "--out", "A.glb"]), /must end in \.vrm/);
});

test("--help", () => {
  assert.equal(parseArgs(["--help"]).flags.help, true);
});
