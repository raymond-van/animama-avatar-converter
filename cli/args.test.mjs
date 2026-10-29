import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "./args.mjs";

test("an export needs a project, a prefab and a .vrm output", () => {
  const { options, flags } = parseArgs([
    "--project",
    "P",
    "--prefab",
    "Assets/A.prefab",
    "--out",
    "A.vrm",
    "--keep-pose",
    "--name",
    "A",
  ]);
  assert.deepEqual(options, {
    project: "P",
    prefab: "Assets/A.prefab",
    out: "A.vrm",
    name: "A",
  });
  assert.deepEqual(flags, { help: false, keepPose: true, validate: false });
  assert.throws(
    () => parseArgs(["--project", "P", "--prefab", "Assets/A.prefab"]),
    /--out is required/,
  );
  assert.throws(
    () => parseArgs(["--project", "P", "--prefab", "A", "--out", "A.glb"]),
    /must end in \.vrm/,
  );
});

test("validation needs no output", () => {
  const { options, flags } = parseArgs([
    "--project",
    "P",
    "--prefab",
    "A",
    "--validate",
  ]);
  assert.equal(options.out, undefined);
  assert.equal(flags.validate, true);
});

test("unknown, misplaced and incomplete options are errors", () => {
  assert.throws(
    () =>
      parseArgs([
        "--project",
        "P",
        "--prefab",
        "A",
        "--out",
        "A.vrm",
        "--no-optimize",
      ]),
    /Unknown option --no-optimize/,
  );
  assert.throws(() => parseArgs(["P"]), /Unexpected argument P/);
  assert.throws(
    () => parseArgs(["--project", "--prefab", "A"]),
    /--project needs a value/,
  );
});

test("--help needs nothing else", () => {
  assert.equal(parseArgs(["--help"]).flags.help, true);
});
