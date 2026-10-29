#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, USAGE } from "./args.mjs";
import {
  embeddedPackages,
  planManifest,
  projectIsOpen,
  releasedPackageSpec,
} from "./project.mjs";
import {
  CANNOT_CONVERT,
  NOT_READY,
  exportArgs,
  exportLines,
  projectEditorVersion,
  readSecondaryInstallPath,
  requirementArgs,
  unityEditorCandidates,
  unityProblem,
} from "./unity.mjs";

/**
 * Export a VRChat Avatar prefab to VRM for Animama without opening the Unity
 * editor's window:
 *
 *   animama-avatar-export --project <unity-project> --prefab <Assets/…/Avatar.prefab> \
 *     --out <Avatar>.vrm [--name …] [--version …] [--author …] [--copyright …] \
 *     [--keep-pose] [--validate] [--unity <editor>] [--package <spec>]
 *
 * It adds the com.animama.avatar-export package and its dependencies to the
 * project's Packages/manifest.json if they are missing, refuses while the
 * project is open in Unity, then runs the package's batch export. The Unity log
 * goes beside the output as `<Avatar>.export.log`. Exit codes: 0 when the VRM
 * was written (or validation passed), 2 when Mochiya cannot convert the
 * prefab (or it needs Modular Avatar), 1 otherwise. Never overwrites a file; nothing is uploaded.
 */

const cliRoot = fileURLToPath(new URL("..", import.meta.url));

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Run a command to completion, resolving with its exit code. */
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

/** The Unity editor to run: --unity, ANIMAMA_UNITY_EDITOR, or the project's version from Unity Hub. */
async function resolveUnityEditor(project, explicit, env) {
  const configured = explicit ?? env.ANIMAMA_UNITY_EDITOR;
  if (configured) {
    if (!(await exists(configured)))
      throw new Error(`The Unity editor ${configured} does not exist.`);
    return configured;
  }
  const version = projectEditorVersion(
    await readFile(
      path.join(project, "ProjectSettings/ProjectVersion.txt"),
      "utf8",
    ),
  );
  const where = {
    platform: process.platform,
    home: os.homedir(),
    appData: env.APPDATA,
  };
  const candidates = version
    ? unityEditorCandidates(version, {
        ...where,
        secondaryInstall: await readSecondaryInstallPath(where),
      })
    : [];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  throw new Error(
    `Unity ${version ?? "(unknown version)"} was not found in Unity Hub's folders; install it from Unity Hub, or pass --unity <editor> or set ANIMAMA_UNITY_EDITOR.`,
  );
}

/** Add the package and its dependencies to the manifest; refuse entries the export cannot use. */
async function prepareManifest(project, packageSpec, log) {
  const manifestPath = path.join(project, "Packages", "manifest.json");
  const plan = planManifest(
    await readFile(manifestPath, "utf8"),
    packageSpec,
    embeddedPackages(project),
  );
  if (plan.conflicts.length > 0) {
    const lines = plan.conflicts.map(
      ({ name, found, wanted }) =>
        `  "${name}": "${found}" (the export needs "${wanted}")`,
    );
    throw new Error(
      `Packages/manifest.json has entries the export cannot use:\n${lines.join("\n")}\nChange these entries, then run again.`,
    );
  }
  if (plan.text !== null) {
    await writeFile(manifestPath, plan.text);
    log(`Added to Packages/manifest.json: ${plan.added.join(", ")}`);
  }
}

const megabytes = async (file) =>
  `${((await stat(file)).size / 1024 / 1024).toFixed(2)} MB`;

/**
 * Run the command. `io` lets tests replace the console, the environment and
 * Unity itself (`runUnity(editor, args)` resolves with Unity's exit code).
 */
export async function main(argv, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;
  const env = io.env ?? process.env;
  const runUnity = io.runUnity ?? run;
  const isOpen = io.projectIsOpen ?? projectIsOpen;

  const { options, flags } = parseArgs(argv);
  if (flags.help) {
    log(USAGE);
    return 0;
  }
  log(
    "Convert only an Avatar whose licence allows you to convert it for your own use, and share the VRM only if the licence allows it.",
  );
  const project = path.resolve(options.project);
  if (!(await exists(path.join(project, "ProjectSettings/ProjectVersion.txt"))))
    throw new Error(
      `${project} is not a Unity project (no ProjectSettings/ProjectVersion.txt).`,
    );
  const out = options.out ? path.resolve(options.out) : null;
  if (out && !flags.validate && (await exists(out)))
    throw new Error(`${out} exists; choose a new --out.`);
  if (out && !(await exists(path.dirname(out))))
    throw new Error(`The folder ${path.dirname(out)} does not exist.`);
  const unityLog = out
    ? `${out.slice(0, -".vrm".length)}.export.log`
    : path.join(project, "Logs", "animama-validate.log");
  await mkdir(path.dirname(unityLog), { recursive: true });

  const open = isOpen(project);
  if (open)
    throw new Error("The project is open in Unity. Close it, then run again.");
  if (open === null)
    log(
      "Could not check whether Unity has the project open (lsof was not found); make sure it is closed.",
    );
  const editor = await resolveUnityEditor(project, options.unity, env);
  const { version } = JSON.parse(
    await readFile(path.join(cliRoot, "package.json"), "utf8"),
  );
  await prepareManifest(
    project,
    options.package ?? releasedPackageSpec(version),
    log,
  );

  log(
    `Unity: ${flags.validate ? "validating" : "exporting"} ${options.prefab} (log: ${unityLog})`,
  );
  const code = await runUnity(
    editor,
    exportArgs({
      project,
      prefab: options.prefab,
      out,
      log: unityLog,
      meta: options,
      keepPose: flags.keepPose,
      validate: flags.validate,
    }),
  );
  const unityOutput = await readFile(unityLog, "utf8").catch(() => "");
  const lines = exportLines(unityOutput);
  if (lines) log(lines);

  if (code === NOT_READY) {
    error(
      "The project does not meet the export's requirements; see above. In Unity, Animama > Check Requirements… can install the dependencies.",
    );
    return 1;
  }
  const problem =
    code === 0 || code === CANNOT_CONVERT ? null : unityProblem(unityOutput);
  if (problem === "projectOpen") {
    error("The project is open in Unity. Close it, then run again.");
    return 1;
  }
  if (problem === "notCompiled") {
    // The export code compiles only when its dependencies are present; say which are not.
    const requirementsLog = `${unityLog.slice(0, -".log".length)}.requirements.log`;
    await runUnity(editor, requirementArgs({ project, log: requirementsLog }));
    const requirements = exportLines(
      await readFile(requirementsLog, "utf8").catch(() => ""),
    );
    error(
      requirements
        ? `The package's export code did not compile in this project.\n${requirements}`
        : `The Animama package did not load in this project. Check the network, Git and --package, and see ${unityLog}.`,
    );
    return 1;
  }
  if (code === CANNOT_CONVERT) {
    error("This prefab cannot be exported; see the report above.");
    return CANNOT_CONVERT;
  }
  if (code !== 0) {
    error(`The Unity batch export failed (exit ${code}); see ${unityLog}.`);
    return 1;
  }
  if (flags.validate) return 0;
  if (!(await exists(out))) {
    error(`Unity finished but ${out} was not written; see ${unityLog}.`);
    return 1;
  }
  log(`Wrote ${out} (${await megabytes(out)}).`);
  return 0;
}

// npm links the command into node_modules/.bin, so compare real paths.
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (failure) => {
      console.error(failure instanceof Error ? failure.message : failure);
      process.exit(1);
    },
  );
}
