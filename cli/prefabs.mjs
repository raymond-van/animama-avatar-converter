import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Finding the prefab to export without starting Unity: every prefab under
 * Assets/, and which of them are VRChat Avatars. An Avatar prefab holds the
 * VRChat SDK's avatar descriptor, or is a variant of one that does.
 */

/** The avatar descriptor script from the VRChat SDK, as prefabs reference it. */
const AVATAR_DESCRIPTOR =
  /m_Script: \{fileID: 542108242, guid: 67cc4cb7839cd3741b63733d5adf0442/;
const META_GUID = /^guid: ([0-9a-f]{32})/m;

/** Every .prefab under Assets/, skipping folders Unity ignores. */
async function walk(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.endsWith("~")) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.name.endsWith(".prefab")) found.push(full);
  }
  return found;
}

/**
 * The base prefab a variant is made from: the prefab instance at its root
 * (one with no parent transform), or null for an ordinary prefab.
 */
export function variantBaseGuid(text) {
  for (const document of text.split("--- !u!1001 ").slice(1)) {
    const body = document.split("\n--- ")[0];
    if (!/m_TransformParent: \{fileID: 0\}/.test(body)) continue;
    const source =
      /m_SourcePrefab: \{fileID: 100100000, guid: ([0-9a-f]{32})/.exec(body);
    if (source) return source[1];
  }
  return null;
}

/**
 * The project's prefabs, each with its project-relative path (forward
 * slashes), name and whether it is a VRChat Avatar.
 */
export async function findPrefabs(project) {
  const assets = path.join(project, "Assets");
  const prefabs = [];
  // One file at a time keeps open files and memory small in large projects.
  for (const file of await walk(assets)) {
    const text = await readFile(file, "utf8");
    const meta = await readFile(`${file}.meta`, "utf8").catch(() => "");
    prefabs.push({
      path: path.relative(project, file).split(path.sep).join("/"),
      name: path.basename(file, ".prefab"),
      guid: META_GUID.exec(meta)?.[1] ?? null,
      hasDescriptor: AVATAR_DESCRIPTOR.test(text),
      baseGuid: variantBaseGuid(text),
    });
  }
  const byGuid = new Map(
    prefabs
      .filter((prefab) => prefab.guid)
      .map((prefab) => [prefab.guid, prefab]),
  );
  const isAvatar = (prefab, seen = new Set()) => {
    if (prefab.hasDescriptor) return true;
    if (!prefab.baseGuid || seen.has(prefab.baseGuid)) return false;
    seen.add(prefab.baseGuid);
    const base = byGuid.get(prefab.baseGuid);
    return base ? isAvatar(base, seen) : false;
  };
  return prefabs
    .map(({ path: prefabPath, name, ...prefab }) => ({
      path: prefabPath,
      name,
      avatar: isAvatar({ name, ...prefab }),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const quote = (name) => (/\s/.test(name) ? `"${name}"` : name);

/** A name that picks exactly this prefab, or its path when other prefabs share the name. */
function handle(prefabs, prefab) {
  const sameName = prefabs.filter(
    (other) => other.name.toLowerCase() === prefab.name.toLowerCase(),
  );
  const avatarsNamed = sameName.filter((other) => other.avatar);
  return sameName.length === 1 || (prefab.avatar && avatarsNamed.length === 1)
    ? prefab.name
    : prefab.path;
}

function avatarList(prefabs) {
  const avatars = prefabs.filter((prefab) => prefab.avatar);
  return avatars.length > 0
    ? `Avatar prefabs in this project:\n${avatars.map((prefab) => `  ${prefab.name}  (${prefab.path})`).join("\n")}`
    : "No VRChat Avatar prefabs were found under Assets/.";
}

/**
 * The project-relative path of the prefab to export: the given path (relative
 * to the current folder or the project, or absolute), the prefab with the
 * given name (ignoring case and a `.prefab` ending; an Avatar wins over other
 * prefabs of that name), or the project's only Avatar prefab when none is
 * given. Anything ambiguous or missing is an error that lists the choices.
 */
export function resolvePrefab(prefabs, argument, { project, cwd } = {}) {
  if (!argument) {
    const avatars = prefabs.filter((prefab) => prefab.avatar);
    if (avatars.length === 1) return avatars[0].path;
    if (avatars.length === 0)
      throw new Error(`${avatarList(prefabs)} Pass the prefab's name or path.`);
    throw new Error(
      `${avatarList(prefabs)}\nRun again with one of them, for example:\n  npx animama-avatar-converter ${quote(handle(prefabs, avatars[0]))}`,
    );
  }
  if (/[\\/]/.test(argument)) {
    const candidates = [argument.replace(/\\/g, "/")];
    if (project)
      candidates.push(
        path
          .relative(project, path.resolve(cwd ?? project, argument))
          .split(path.sep)
          .join("/"),
      );
    const found = prefabs.find((prefab) =>
      candidates.some(
        (candidate) => prefab.path.toLowerCase() === candidate.toLowerCase(),
      ),
    );
    if (found) return found.path;
    throw new Error(`No prefab at ${argument}.\n${avatarList(prefabs)}`);
  }
  const name = argument.replace(/\.prefab$/i, "").toLowerCase();
  const named = prefabs.filter((prefab) => prefab.name.toLowerCase() === name);
  const avatarsNamed = named.filter((prefab) => prefab.avatar);
  const matches = avatarsNamed.length === 1 ? avatarsNamed : named;
  if (matches.length === 1) return matches[0].path;
  if (matches.length > 1)
    throw new Error(
      `Several prefabs are named ${argument}; pass one path instead:\n${matches.map((prefab) => `  ${prefab.path}`).join("\n")}`,
    );
  throw new Error(`No prefab named ${argument}.\n${avatarList(prefabs)}`);
}
