import { access, link, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ConversionError, convertPmx } from "../pmx/convert.mjs";
import { PmxFormatError } from "../pmx/reader.mjs";
import { formatReport } from "../pmx/report.mjs";

/** Exit status when the model cannot be converted, as for a VRChat Avatar Mochiya rejects. */
export const CANNOT_CONVERT = 2;

/** Options that only mean something for a Unity project. */
export const UNITY_ONLY_OPTIONS = ["project", "unity", "package", "log"];

/** Whether the command's argument names a PMX model rather than a prefab. */
export const isPmxArgument = (argument) => typeof argument === "string" && /\.pmx$/i.test(argument);

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/**
 * Convert a PMX model to a VRM beside it (or at --out). Needs no Unity.
 * Never overwrites a file, and leaves no partial file when it fails.
 * @param {{options: Record<string, string>, flags: {validate: boolean, keepPose: boolean}, cwd: string, version: string, log: (line: string) => void, error: (line: string) => void}} run
 * @returns {Promise<number>} The exit status.
 */
export async function convertPmxCommand({ options, flags, cwd, version, log, error }) {
  const unity = UNITY_ONLY_OPTIONS.filter((name) => options[name] !== undefined);
  if (unity.length > 0)
    throw new Error(`${unity.map((name) => `--${name}`).join(", ")} ${unity.length > 1 ? "are" : "is"} for Unity Avatars; an MMD model (.pmx) needs no Unity project.`);
  const input = path.resolve(cwd, options.prefab);
  if (!(await exists(input))) throw new Error(`${input} does not exist.`);
  const stem = path.basename(input, path.extname(input));
  // Validation writes nothing, so --out is not used.
  const out = flags.validate ? null : options.out ? path.resolve(cwd, options.out) : path.join(path.dirname(input), `${stem}.vrm`);
  if (out && (await exists(out))) throw new Error(`${out} exists; choose a new --out.`);
  if (out && !(await exists(path.dirname(out)))) throw new Error(`The folder ${path.dirname(out)} does not exist.`);

  log(`${flags.validate ? "Checking" : "Converting"} ${input}`);
  let result;
  try {
    result = convertPmx(new Uint8Array(await readFile(input)), {
      baseDir: path.dirname(input),
      converterVersion: version,
      name: options.name,
      version: options.version,
      author: options.author,
      copyright: options.copyright,
      keepPose: flags.keepPose,
      fallbackName: stem,
    });
  } catch (failure) {
    if (failure instanceof PmxFormatError || failure instanceof ConversionError) {
      if (failure.report) log(formatReport(failure.report));
      error(`This model cannot be converted: ${failure.message}`);
      return CANNOT_CONVERT;
    }
    throw failure;
  }
  log(formatReport(result.report));
  if (!out) return 0;

  await writeNewFile(out, result.glb);
  log(`Wrote ${out} (${((await stat(out)).size / 1024 / 1024).toFixed(2)} MB).`);
  return 0;
}

/**
 * Write a file that must not exist yet. The bytes go to a temporary file
 * beside it first, so a failure leaves no partial file; a hard link then
 * gives it its name, which fails rather than overwrite a file that appeared
 * meanwhile. Where the file system has no hard links (FAT, some network
 * shares), it checks and renames instead.
 * @param {string} file
 * @param {Uint8Array} data
 */
async function writeNewFile(file, data) {
  const partial = `${file}.${process.pid}.part`;
  try {
    await writeFile(partial, data, { flag: "wx" });
  } catch (failure) {
    // A partial file left by a failed write is ours to remove; an existing one (EEXIST) is not.
    if (failure.code !== "EEXIST") await unlink(partial).catch(() => {});
    throw failure;
  }
  try {
    await link(partial, file);
  } catch (failure) {
    if (failure.code === "EEXIST") throw new Error(`${file} appeared while converting; choose a new --out.`);
    if (!["EPERM", "ENOTSUP", "EXDEV", "ENOSYS", "EINVAL", "EACCES"].includes(failure.code)) throw failure;
    if (await exists(file)) throw new Error(`${file} appeared while converting; choose a new --out.`);
    await rename(partial, file);
  } finally {
    await unlink(partial).catch(() => {});
  }
}
