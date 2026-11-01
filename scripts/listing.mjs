import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The VPM listing (index.json) that VRChat Creator Companion and ALCOM read.
 * It is rebuilt on every release from the zips attached to the GitHub
 * releases themselves, so it always lists every released version with the
 * hash of the file users download, and never depends on the previously
 * published listing.
 */

export const PACKAGE_NAME = "com.animama.avatar-converter";

export const LISTING = {
  name: "Animama",
  id: "com.animama.vpm",
  url: "https://raymond-van.github.io/animama-avatar-converter/index.json",
  author: "Animama",
};

/** The release zip's file name and download URL for a version. */
export function releaseZip(repository, version) {
  const name = `${PACKAGE_NAME}-${version}.zip`;
  return {
    name,
    url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
  };
}

/** One version's listing entry: the package manifest plus its zip. */
export function listingEntry(packageJson, zipUrl, zipSHA256) {
  return { ...packageJson, url: zipUrl, zipSHA256 };
}

/** Compares two semantic versions (pre-release suffixes sort before the release). */
export function compareVersions(a, b) {
  const parse = (version) => {
    const [core, pre = ""] = version.split("-", 2);
    return { parts: core.split(".").map(Number), pre };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** The listing for a set of entries, one per version, in version order. */
export function buildListing(entries) {
  const versions = {};
  for (const entry of [...entries].sort((a, b) =>
    compareVersions(a.version, b.version),
  )) {
    if (entry.name !== PACKAGE_NAME)
      throw new Error(
        `A release zip holds ${entry.name}, not ${PACKAGE_NAME}.`,
      );
    if (versions[entry.version])
      throw new Error(`Version ${entry.version} appears twice.`);
    versions[entry.version] = entry;
  }
  return { ...LISTING, packages: { [PACKAGE_NAME]: { versions } } };
}

/** The package manifest inside a release zip (package.json at its root). */
export function readZipManifest(zipPath) {
  const unzip = spawnSync("unzip", ["-p", zipPath, "package.json"], {
    encoding: "utf8",
  });
  if (unzip.status !== 0)
    throw new Error(`${zipPath} has no package.json at its root.`);
  return JSON.parse(unzip.stdout);
}

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
