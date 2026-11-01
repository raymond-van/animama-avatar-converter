import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Running Unity in batch mode against the package's entry points. Unity runs
 * with graphics, never `-nographics`: the exporter reads compressed textures
 * back through the GPU and writes flat grey placeholders without one.
 */

const BATCH_EXPORT = "Animama.AvatarConverter.BatchExport";
const BATCH_REQUIREMENTS = "Animama.AvatarConverter.BatchRequirements.Check";

/** Batch exit code: Mochiya cannot convert the prefab, or it needs Modular Avatar. */
export const CANNOT_CONVERT = 2;

/** Batch exit code: the project misses a requirement (BatchRequirements and BatchExport). */
export const NOT_READY = 3;

/** VRM metadata options and the batch export arguments that carry them. */
const META_ARGUMENTS = {
  name: "-animamaName",
  version: "-animamaVersion",
  author: "-animamaAuthor",
  copyright: "-animamaCopyright",
};

/** Folders where Unity Hub installs editor versions, for a platform. */
function hubEditorFolders(platform, home, secondaryInstall) {
  const folders = [];
  if (platform === "darwin") folders.push("/Applications/Unity/Hub/Editor");
  else if (platform === "win32")
    folders.push("C:\\Program Files\\Unity\\Hub\\Editor");
  else folders.push(path.posix.join(home, "Unity/Hub/Editor"));
  if (secondaryInstall) folders.push(secondaryInstall);
  return folders;
}

/** The editor executable inside a Unity Hub version folder. */
function editorExecutable(folder, version, platform) {
  if (platform === "darwin")
    return path.posix.join(folder, version, "Unity.app/Contents/MacOS/Unity");
  if (platform === "win32")
    return path.win32.join(folder, version, "Editor", "Unity.exe");
  return path.posix.join(folder, version, "Editor/Unity");
}

/**
 * Where Unity Hub may have installed an editor version: its default folder,
 * then the custom install folder set in Unity Hub's preferences.
 */
export function unityEditorCandidates(
  version,
  { platform, home, secondaryInstall },
) {
  return hubEditorFolders(platform, home, secondaryInstall).map((folder) =>
    editorExecutable(folder, version, platform),
  );
}

/** Unity Hub's custom install folder, from its preferences, or null. */
export async function readSecondaryInstallPath({ platform, home, appData }) {
  const file =
    platform === "win32"
      ? path.win32.join(appData ?? "", "UnityHub", "secondaryInstallPath.json")
      : platform === "darwin"
        ? path.posix.join(
            home,
            "Library/Application Support/UnityHub/secondaryInstallPath.json",
          )
        : path.posix.join(home, ".config/UnityHub/secondaryInstallPath.json");
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** The project's editor version from ProjectSettings/ProjectVersion.txt. */
export function projectEditorVersion(projectVersionText) {
  return /m_EditorVersion:\s*(\S+)/.exec(projectVersionText)?.[1] ?? null;
}

/** The batch export's command line. */
export function exportArgs({
  project,
  prefab,
  out,
  log,
  meta,
  keepPose,
  validate,
}) {
  const args = [
    "-batchmode",
    "-quit",
    "-projectPath",
    project,
    "-logFile",
    log,
    "-executeMethod",
    `${BATCH_EXPORT}.${validate ? "Validate" : "Export"}`,
    "-animamaPrefab",
    prefab,
  ];
  if (!validate) args.push("-animamaOut", out);
  for (const [key, argument] of Object.entries(META_ARGUMENTS)) {
    if (meta[key]) args.push(argument, meta[key]);
  }
  if (keepPose) args.push("-animamaKeepPose");
  return args;
}

/** The requirement check's command line; it compiles without the dependencies. */
export function requirementArgs({ project, log }) {
  return [
    "-batchmode",
    "-quit",
    "-projectPath",
    project,
    "-logFile",
    log,
    "-executeMethod",
    BATCH_REQUIREMENTS,
  ];
}

/**
 * The package's own lines from a Unity log: each `[Animama]` line, and the
 * whole Validate report, whose lines run on until Unity's stack trace.
 */
export function exportLines(log) {
  const lines = [];
  let inReport = false;
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith("[Animama]")) {
      lines.push(line);
      inReport = line.startsWith("[Animama] Validate:");
    } else if (inReport) {
      if (!line.trim() || line.startsWith("UnityEngine.")) inReport = false;
      else lines.push(`  ${line}`);
    }
  }
  return lines.join("\n");
}

/** Why a batch run did not reach the package, from its log, or null. */
export function unityProblem(log) {
  if (/another Unity instance is running with this project open/i.test(log))
    return "projectOpen";
  if (/executeMethod (class|method) .* could not be found/i.test(log))
    return "notCompiled";
  return null;
}
