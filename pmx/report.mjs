/**
 * The conversion report in plain language, as the command prints it.
 * @param {import("./context.mjs").ConvertReport} report
 * @returns {string}
 */
export function formatReport(report) {
  const { model } = report;
  const lines = [
    `Model: ${model.name} — ${model.vertices.toLocaleString("en")} vertices, ${model.faces.toLocaleString("en")} faces, ${model.materials} materials, ${model.bones} bones, ${model.heightMetres.toFixed(2)} m tall.`,
    `Humanoid: ${report.humanBones.length} bones mapped${report.missingRequired.length ? `; missing required: ${report.missingRequired.join(", ")}` : ""}.`,
    `Face morphs: ${report.morphTargets} kept as morph targets.`,
  ];
  if (report.expressions.length > 0) {
    lines.push("Expressions:");
    for (const { name, binds } of report.expressions) lines.push(`  ${name}: ${binds.length ? binds.join(" + ") : "(neutral)"}`);
  }
  if (report.springs) lines.push(...report.springs);
  if (report.lookAt) lines.push(`Look-at: ${report.lookAt}`);
  if (report.missingTextures.length > 0) {
    lines.push("Textures that could not be used (those materials are untextured):");
    for (const { stored, problem } of report.missingTextures) lines.push(`  ${stored}: ${problem}`);
  }
  const dropped = Object.entries(report.dropped);
  if (dropped.length > 0) {
    lines.push("Not carried over (VRM has no equivalent):");
    for (const [feature, count] of dropped) lines.push(`  ${feature}: ${count}`);
  }
  for (const note of report.notes) lines.push(`Note: ${note}`);
  for (const warning of report.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}
