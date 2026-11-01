#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Guards `npm publish` (run as `prepublishOnly`): npm never reuses a version,
 * so publish only a clean checkout of the released tag, after the release
 * checks pass.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const git = (...args) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8" });

const problems = [];
const tag = git("describe", "--exact-match", "--tags", "HEAD").stdout.trim();
if (tag !== `v${version}`)
  problems.push(
    `HEAD is ${tag ? `tagged ${tag}` : "not a tagged commit"}; check out v${version} first.`,
  );
if (git("status", "--porcelain").stdout.trim())
  problems.push("The checkout has uncommitted or untracked files.");
const check = spawnSync(
  process.execPath,
  ["scripts/check.mjs", "--tag", `v${version}`],
  {
    cwd: root,
    stdio: "inherit",
  },
);
if (check.status !== 0) problems.push("The release checks failed.");
if (problems.length > 0) {
  console.error(
    `Not publishing ${version}:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
  );
  process.exit(1);
}
