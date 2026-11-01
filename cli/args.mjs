/**
 * Command-line options for `animama-avatar-converter`. Unknown or incomplete
 * options are errors, not ignored.
 */

export const USAGE = [
  "Usage, in your Unity project's folder:",
  "  npx animama-avatar-converter [<Avatar prefab name or path>] [options]",
  "",
  "With no prefab, the project's only Avatar prefab is used; if it has several,",
  "they are listed.",
  "",
  "Options:",
  "  --out <file.vrm>        where to write the VRM (default: ./<prefab name>.vrm)",
  "  --name, --version, --author, --copyright <text>",
  "                          VRM details (the name defaults to the prefab's)",
  "  --keep-pose             export the modelled pose instead of the T-pose",
  "  --validate              only validate; write no VRM",
  "  --project <folder>      the Unity project (default: the current folder)",
  "  --unity <editor>        the Unity editor (default: the project's version from",
  "                          Unity Hub, or ANIMAMA_UNITY_EDITOR)",
  "  --log <file>            Unity's log (default: beside the VRM as <name>.export.log)",
  "  --package <spec>        the Unity package entry to install (for testing",
  "                          unreleased versions)",
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
  "log",
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
    } else if (!name && options.prefab === undefined) {
      // The one positional argument is the prefab.
      options.prefab = argument;
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
  if (options.out && !options.out.toLowerCase().endsWith(".vrm"))
    throw new Error(`--out must end in .vrm.\n\n${USAGE}`);
  return { options, flags };
}
