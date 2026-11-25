import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { syntheticHumanoid, writeModelFolder } from "../pmx/testing/synthetic.mjs";
import { main } from "./main.mjs";

async function modelFolder() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pmx-cli-"));
  return { dir, file: await writeModelFolder(dir, syntheticHumanoid()) };
}

function capture() {
  const lines = [];
  const errors = [];
  return { lines, errors, io: { log: (l) => lines.push(l), error: (l) => errors.push(l) } };
}

test("converts a .pmx beside the model without a Unity project", async () => {
  const { dir, file } = await modelFolder();
  const { lines, io } = capture();
  assert.equal(await main([file], { ...io, cwd: os.tmpdir() }), 0);
  const vrm = await readFile(path.join(dir, "model.vrm"));
  assert.equal(vrm.readUInt32LE(0), 0x46546c67);
  assert.ok(lines.some((l) => /Humanoid: \d+ bones mapped/.test(l)));
  assert.ok(lines.at(-1).startsWith("Wrote "));
  assert.deepEqual((await readdir(dir)).filter((f) => f.endsWith(".part")), []);
});

test("accepts a relative path and --out, in any case of the extension", async () => {
  const { dir } = await modelFolder();
  const upper = path.join(dir, "MODEL.PMX");
  await writeFile(upper, await readFile(path.join(dir, "model.pmx")));
  const { io } = capture();
  assert.equal(await main(["MODEL.PMX", "--out", "out.vrm", "--name", "Named"], { ...io, cwd: dir }), 0);
  assert.ok((await readdir(dir)).includes("out.vrm"));
});

test("never overwrites a file", async () => {
  const { dir, file } = await modelFolder();
  await writeFile(path.join(dir, "model.vrm"), "keep");
  const { io } = capture();
  await assert.rejects(main([file], { ...io, cwd: dir }), /exists; choose a new --out/);
  assert.equal(await readFile(path.join(dir, "model.vrm"), "utf8"), "keep");
});

test("--validate reports and writes nothing, even with --out", async () => {
  const { dir, file } = await modelFolder();
  const { lines, io } = capture();
  assert.equal(await main([file, "--validate"], { ...io, cwd: dir }), 0);
  assert.equal(await main([file, "--validate", "--out", "check.vrm"], { ...io, cwd: dir }), 0);
  assert.ok(lines.some((l) => /Humanoid/.test(l)));
  const files = await readdir(dir);
  assert.ok(!files.includes("model.vrm") && !files.includes("check.vrm"));
});

test("exits 2 for a file that is not a convertible PMX", async () => {
  const { dir } = await modelFolder();
  const bad = path.join(dir, "bad.pmx");
  await writeFile(bad, "Pmd not really");
  const { errors, io } = capture();
  assert.equal(await main([bad], { ...io, cwd: dir }), 2);
  assert.match(errors[0], /PMD/);
  assert.ok(!(await readdir(dir)).includes("bad.vrm"));
});

test("refuses Unity-only options and missing files", async () => {
  const { dir, file } = await modelFolder();
  const { io } = capture();
  await assert.rejects(main([file, "--project", "."], { ...io, cwd: dir }), /--project is for Unity Avatars/);
  await assert.rejects(main(["missing.pmx"], { ...io, cwd: dir }), /does not exist/);
});

test("--expression chooses an expression's morphs; bad names are refused before reading, unknown morphs after", async () => {
  const { dir, file } = await modelFolder();
  const { lines, io } = capture();
  assert.equal(await main([file, "--validate", "--expression", "happy=あ*0.5+まばたき", "--expression", "Fcl_BRW_Angry="], { ...io, cwd: dir }), 0);
  const report = lines.join("\n");
  assert.match(report, /happy: brows —, eyes まばたき, mouth あ×0\.5/);
  assert.match(report, /angry: brows —,/);
  await assert.rejects(main([file, "--validate", "--expression", "happy"], { ...io, cwd: dir }), /needs <name>=<morph>/);
  await assert.rejects(main(["missing.pmx", "--expression", "joy=あ"], { ...io, cwd: dir }), /not a preset or part/, "before the file is even looked at");
  await assert.rejects(main([file, "--validate", "--expression", "sad=泣く"], { ...io, cwd: dir }), /no face morph named "泣く"/);
  await assert.rejects(main(["Avatar", "--expression", "happy=あ"], { ...io, cwd: dir }), /only for MMD models/);
});
