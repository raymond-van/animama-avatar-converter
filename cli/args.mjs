/**
 * Command-line options for `animama-avatar-export`. Unknown or incomplete
 * options are errors, not ignored.
 */

export const USAGE = [
  "Usage:",
  "  animama-avatar-export --project <unity-project> --prefab <Assets/…/Avatar.prefab> --out <Avatar>.vrm",
  "    [--name <name>] [--version <version>] [--author <author>] [--copyright <credit>]",
  "    [--keep-pose] [--validate] [--unity <editor>] [--package <package-spec>]",
  "",
  "  --validate     run Mochiya's validation only; --out is optional",
  "  --keep-pose    export the modelled pose instead of the T-pose VRM 1.0 expects",
  "  --unity        the Unity editor to run (default: the project's version from Unity Hub,",
  "                 or ANIMAMA_UNITY_EDITOR)",
  "  --package      the com.animama.avatar-export entry to add to Packages/manifest.json",
  "                 (default: this command's release; for testing unreleased versions)",
].join("\n");

const VALUE_OPTIONS = [
  "project",
  "prefab",
  "out",
  "unity",
  "name",
  "version",
  "author",
  "copyright",
  "package",
];
const FLAG_OPTIONS = ["keep-pose", "validate", "help"];

export function parseArgs(argv) {
  const options = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const name = argument.startsWith("--") ? argument.slice(2) : null;
    if (name && FLAG_OPTIONS.includes(name)) seen.add(name);
    else if (name && VALUE_OPTIONS.includes(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`--${name} needs a value.\n\n${USAGE}`);
      options[name] = value;
      index += 1;
    } else
      throw new Error(
        `${name ? `Unknown option --${name}` : `Unexpected argument ${argument}`}.\n\n${USAGE}`,
      );
  }
  const flags = {
    help: seen.has("help"),
    keepPose: seen.has("keep-pose"),
    validate: seen.has("validate"),
  };
  if (!flags.help) {
    const required = flags.validate
      ? ["project", "prefab"]
      : ["project", "prefab", "out"];
    for (const option of required) {
      if (!options[option])
        throw new Error(`--${option} is required.\n\n${USAGE}`);
    }
    if (options.out && !options.out.toLowerCase().endsWith(".vrm"))
      throw new Error(`--out must end in .vrm.\n\n${USAGE}`);
  }
  return { options, flags };
}
