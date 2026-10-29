#!/usr/bin/env node
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildListing,
  listingEntry,
  PACKAGE_NAME,
  readZipManifest,
  releaseZip,
  sha256,
} from "./listing.mjs";

/**
 * Builds the VPM listing from the release zips in a folder (in a release, the
 * assets of every GitHub release):
 *
 *   node scripts/build-listing.mjs --repository <owner/name> --zips <dir> --out <dir> [--require <version>]
 *
 * Each zip must be named <package>-<version>.zip and hold that version. Writes
 * <out>/index.json. --require fails the build when that version is missing.
 */

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repository = option("repository");
const zips = option("zips");
const out = option("out");
const required = option("require");
if (!repository || !zips || !out) {
  console.error(
    "Usage: node scripts/build-listing.mjs --repository <owner/name> --zips <dir> --out <dir> [--require <version>]",
  );
  process.exit(1);
}

const pattern = new RegExp(
  `^${PACKAGE_NAME.replace(/\./g, "\\.")}-(.+)\\.zip$`,
);
const entries = readdirSync(zips)
  .map((name) => ({ name, version: pattern.exec(name)?.[1] }))
  .filter(({ version }) => version)
  .map(({ name, version }) => {
    const zipPath = path.join(zips, name);
    const manifest = readZipManifest(zipPath);
    if (manifest.version !== version)
      throw new Error(`${name} holds version ${manifest.version}.`);
    return listingEntry(
      manifest,
      releaseZip(repository, version).url,
      sha256(zipPath),
    );
  });
if (entries.length === 0) throw new Error(`No release zips in ${zips}.`);
const listing = buildListing(entries);
const versions = Object.keys(listing.packages[PACKAGE_NAME].versions);
if (required && !versions.includes(required))
  throw new Error(`The listing lacks version ${required}.`);
mkdirSync(out, { recursive: true });
writeFileSync(
  path.join(out, "index.json"),
  JSON.stringify(listing, null, 2) + "\n",
);
console.log(`listing: ${versions.join(", ")}`);
