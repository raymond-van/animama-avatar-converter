#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEPENDENCIES,
  MOCHIYA_COMMIT,
  UNIVRM_VERSION,
} from "../cli/project.mjs";

/**
 * Repository checks that need no Unity, run by CI and before a release:
 *
 * - the command's and the Unity package's versions agree; with --tag they
 *   also match the tag, the README's install lines and a released CHANGELOG
 *   heading;
 * - every dependency pin agrees: Requirements.cs's versions and URLs, the
 *   export assemblies' version defines and the command's manifest entries;
 * - the package and the command contain no network or upload code;
 * - every package file and folder has a Unity .meta file;
 * - the Unity package manifest has the fields VPM listings need.
 *
 *   node scripts/check.mjs [--tag v0.1.0]
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const packageDir = path.join(root, "Packages", "com.animama.avatar-export");
const problems = [];

const read = (file) => readFileSync(path.join(root, file), "utf8");
const cliPackage = JSON.parse(read("package.json"));
const unityPackage = JSON.parse(
  read("Packages/com.animama.avatar-export/package.json"),
);
const version = unityPackage.version;

if (cliPackage.version !== version)
  problems.push(
    `package.json version ${cliPackage.version} differs from the Unity package's ${version}.`,
  );
const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0) {
  const tag = process.argv[tagIndex + 1] ?? "";
  if (tag !== `v${version}`)
    problems.push(`Tag "${tag}" does not match version ${version}.`);
  const readmePins = [
    ...read("README.md").matchAll(/animama-avatar-export[^\s`]*#v([\w.-]+)/g),
  ].map((match) => match[1]);
  if (readmePins.length === 0 || readmePins.some((pin) => pin !== version))
    problems.push(
      `README.md's install lines pin ${readmePins.join(", ") || "nothing"}, not ${version}.`,
    );
  const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")}(.*)$`, "m");
  const released = heading.exec(
    read("Packages/com.animama.avatar-export/CHANGELOG.md"),
  );
  if (!released || /unreleased/i.test(released[1]))
    problems.push(`CHANGELOG.md has no released "## ${version}" heading.`);
}

for (const field of [
  "name",
  "version",
  "displayName",
  "description",
  "unity",
]) {
  if (!unityPackage[field])
    problems.push(`The Unity package.json has no ${field}.`);
}
if (!unityPackage.author?.name)
  problems.push("The Unity package.json has no author.name.");

const requirements = read(
  "Packages/com.animama.avatar-export/Editor/Bootstrap/Requirements.cs",
);
const constant = (name) =>
  new RegExp(`const string ${name} = "([^"]+)"`).exec(requirements)?.[1];
const pinned = (description, found, wanted) => {
  if (found !== wanted)
    problems.push(`${description} is ${found}; expected ${wanted}.`);
};
pinned(
  "Requirements.cs UniVrmVersion",
  constant("UniVrmVersion"),
  UNIVRM_VERSION,
);
pinned(
  "Requirements.cs MochiyaCommit",
  constant("MochiyaCommit"),
  MOCHIYA_COMMIT,
);
pinned(
  "Requirements.cs UniGltfUrl",
  constant("UniGltfUrl"),
  DEPENDENCIES["com.vrmc.gltf"],
);
pinned(
  "Requirements.cs Vrm10Url",
  constant("Vrm10Url"),
  DEPENDENCIES["com.vrmc.vrm"],
);
const mochiyaUrl = /const string MochiyaUrl = "([^"]+)" \+ MochiyaCommit;/.exec(
  requirements,
)?.[1];
pinned(
  "Requirements.cs MochiyaUrl",
  `${mochiyaUrl}${MOCHIYA_COMMIT}`,
  DEPENDENCIES["org.mochiya.avatar-tools"],
);
pinned(
  "Requirements.cs Vrm0Url",
  constant("Vrm0Url"),
  `https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM#v${UNIVRM_VERSION}`,
);
for (const asmdef of [
  "Packages/com.animama.avatar-export/Editor/Export/Animama.AvatarExport.Editor.asmdef",
  "Packages/com.animama.avatar-export/Tests/Editor/Export/Animama.AvatarExport.Editor.Tests.asmdef",
]) {
  const defines = Object.fromEntries(
    JSON.parse(read(asmdef)).versionDefines.map((define) => [
      define.name,
      define.expression,
    ]),
  );
  const name = path.basename(asmdef);
  pinned(
    `${name} UniVRM define`,
    defines["com.vrmc.vrm"],
    `[${UNIVRM_VERSION}]`,
  );
  pinned(
    `${name} Mochiya define`,
    defines["org.mochiya.avatar-tools"],
    `[${constant("MochiyaVersion")}]`,
  );
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? [full, ...walk(full)] : [full];
  });
}

// Unity ignores names starting with "." and folders ending in "~", and needs no .meta for them.
const packageFiles = walk(packageDir).filter(
  (file) =>
    !path
      .relative(packageDir, file)
      .split(path.sep)
      .some((part) => part.startsWith(".") || part.endsWith("~")),
);
for (const file of packageFiles) {
  if (file.endsWith(".meta")) {
    if (!packageFiles.includes(file.slice(0, -".meta".length)))
      problems.push(`${path.relative(root, file)} has no matching file.`);
  } else if (!packageFiles.includes(`${file}.meta`)) {
    problems.push(`${path.relative(root, file)} has no .meta file.`);
  }
}

const NETWORK_CODE = {
  ".cs": /UnityWebRequest|HttpClient|WebClient|System\.Net|Mochiya\w*Upload/,
  ".mjs":
    /\bfetch\(|["'](node:)?(https?|http2|net|tls|dgram)["']|XMLHttpRequest|WebSocket/,
};
const sources = [
  ...packageFiles.filter((file) => file.endsWith(".cs")),
  ...readdirSync(path.join(root, "cli")).map((name) =>
    path.join(root, "cli", name),
  ),
];
for (const file of sources) {
  const pattern = NETWORK_CODE[path.extname(file)];
  if (pattern?.test(readFileSync(file, "utf8")))
    problems.push(
      `${path.relative(root, file)} contains network or upload code (${pattern}).`,
    );
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `- ${problem}`).join("\n"));
  process.exit(1);
}
console.log(
  `OK: version ${version}, ${packageFiles.length} package files and folders, ${sources.length} sources checked.`,
);
