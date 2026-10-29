#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_NAME, readZipManifest, sha256 } from "./listing.mjs";

/**
 * Zips the Unity package for a release, with package.json at the zip's root
 * as VPM expects:
 *
 *   node scripts/pack.mjs --out <dir>
 *
 * Writes <dir>/com.animama.avatar-export-<version>.zip, replacing a zip of the
 * same name, and leaves out dotfiles. Needs the `zip` and `unzip` commands
 * (present on GitHub's Ubuntu runners and macOS).
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const packageDir = path.join(root, "Packages", PACKAGE_NAME);

const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
if (!out) {
  console.error("Usage: node scripts/pack.mjs --out <dir>");
  process.exit(1);
}

const { version } = JSON.parse(
  readFileSync(path.join(packageDir, "package.json"), "utf8"),
);
const zipPath = path.resolve(out, `${PACKAGE_NAME}-${version}.zip`);
mkdirSync(path.dirname(zipPath), { recursive: true });
// zip updates an existing archive in place, which would keep stale entries.
rmSync(zipPath, { force: true });
// -X drops extra file attributes and -D directory entries.
const zipped = spawnSync(
  "zip",
  ["-q", "-r", "-X", "-D", zipPath, ".", "-x", ".*", "*/.*"],
  { cwd: packageDir, stdio: "inherit" },
);
if (zipped.status !== 0) {
  console.error("zip failed.");
  process.exit(1);
}
if (readZipManifest(zipPath).version !== version) {
  console.error(`${zipPath} does not hold version ${version}.`);
  process.exit(1);
}
console.log(`${zipPath} ${sha256(zipPath)}`);
