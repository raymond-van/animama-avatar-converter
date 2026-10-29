import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Preparing a Unity project: the Packages/manifest.json entries the export
 * needs, and whether the project is open in Unity.
 *
 * The dependency versions match the package's Requirements.cs; the package
 * repository's checks keep them in step.
 */

export const PACKAGE_NAME = "com.animama.avatar-export";
export const UNIVRM_VERSION = "0.131.2";
export const MOCHIYA_COMMIT = "0826f6e3e453ac1885d6594b831181655c4a1b5c";

export const DEPENDENCIES = {
  "com.vrmc.gltf": `https://github.com/vrm-c/UniVRM.git?path=/Packages/UniGLTF#v${UNIVRM_VERSION}`,
  "com.vrmc.vrm": `https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v${UNIVRM_VERSION}`,
  "org.mochiya.avatar-tools": `https://github.com/mochiya-labs/unity-avatar-tools.git#${MOCHIYA_COMMIT}`,
};

/** The Git URL of this package at a released version. */
export function releasedPackageSpec(version) {
  return `https://github.com/raymond-van/animama-avatar-export.git?path=/Packages/${PACKAGE_NAME}#v${version}`;
}

/** UniVRM for VRM 0.x is optional, but must match UniGLTF's version when present. */
const UNIVRM_0 = "com.vrmc.univrm";
const UNIVRM_PACKAGES = ["com.vrmc.gltf", "com.vrmc.vrm", UNIVRM_0];

/**
 * Whether an existing manifest entry already provides the supported package:
 * UniVRM by version from any source, Mochiya at the tested commit, and this
 * package exactly as requested.
 */
function satisfies(name, existing, wanted) {
  if (existing === wanted) return true;
  if (UNIVRM_PACKAGES.includes(name))
    return (
      existing === UNIVRM_VERSION || existing.endsWith(`#v${UNIVRM_VERSION}`)
    );
  if (name === "org.mochiya.avatar-tools")
    return existing.endsWith(`#${MOCHIYA_COMMIT}`);
  return false;
}

/**
 * Packages embedded in the project's Packages folder, as VRChat Creator
 * Companion installs them; Unity uses them instead of manifest entries.
 */
export function embeddedPackages(project) {
  const packages = path.join(project, "Packages");
  return new Set(
    readdirSync(packages, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(path.join(packages, entry.name, "package.json")),
      )
      .map((entry) => entry.name),
  );
}

/**
 * The manifest with the export's entries added. Returns the new text (null
 * when nothing changes), the names added, and conflicts: entries the export
 * cannot use, which are left for the user to change. Embedded packages count
 * as present. Keeps the file's indentation, line endings, final newline and
 * byte-order mark.
 */
export function planManifest(text, packageSpec, embedded = new Set()) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  let manifest;
  try {
    manifest = JSON.parse(text.slice(bom.length));
  } catch (error) {
    throw new Error(
      `Packages/manifest.json is not valid JSON: ${error.message}`,
    );
  }
  const dependencies = (manifest.dependencies ??= {});
  const wanted = { ...DEPENDENCIES, [PACKAGE_NAME]: packageSpec };
  const added = [];
  const conflicts = [];
  // An installed UniVRM for VRM 0.x must move to UniGLTF's version too.
  const univrm0 = dependencies[UNIVRM_0];
  if (univrm0 !== undefined && !satisfies(UNIVRM_0, univrm0))
    conflicts.push({ name: UNIVRM_0, found: univrm0, wanted: UNIVRM_VERSION });
  for (const [name, spec] of Object.entries(wanted)) {
    const existing = dependencies[name];
    if (existing === undefined && embedded.has(name)) continue;
    if (existing === undefined) {
      dependencies[name] = spec;
      added.push(name);
    } else if (!satisfies(name, existing, spec)) {
      conflicts.push({ name, found: existing, wanted: spec });
    }
  }
  if (conflicts.length > 0) return { text: null, added: [], conflicts };
  if (added.length === 0) return { text: null, added, conflicts };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? "  ";
  let updated =
    bom + JSON.stringify(manifest, null, indent).replace(/\n/g, eol);
  if (/\r?\n$/.test(text)) updated += eol;
  return { text: updated, added, conflicts };
}

/**
 * Whether Unity has the project open: it holds Temp/UnityLockfile while it
 * runs (a leftover file from a crash is not held). Null when this cannot be
 * told: `lsof` is missing.
 */
export function projectIsOpen(project, platform = process.platform) {
  const lockfile = path.join(project, "Temp", "UnityLockfile");
  if (!existsSync(lockfile)) return false;
  if (platform === "win32") {
    // Unity opens the file exclusively, so a second open fails while it runs.
    try {
      closeSync(openSync(lockfile, "r+"));
      return false;
    } catch (error) {
      // A sharing violation; a read-only or access-denied file is not a lock.
      return error.code === "EBUSY";
    }
  }
  const lsof = spawnSync("lsof", ["-t", lockfile], { encoding: "utf8" });
  if (lsof.error) return null;
  return lsof.status === 0 && lsof.stdout.trim().length > 0;
}
