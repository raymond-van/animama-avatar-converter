/**
 * Normalises a bone or morph name for matching: NFKC (full-width digits and
 * letters to ASCII, half-width katakana to full-width), lower case, and no
 * spaces, underscores, dots or hyphens. From pmx-to-vrm's `Names` (MIT).
 * @param {string} name
 */
export function normalizeName(name) {
  return (name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_.\-　]/g, "");
}

/**
 * A name made unique against those already used, by appending _2, _3 …
 * @param {string} name
 * @param {Set<string>} used Updated with the result.
 */
export function uniqueName(name, used) {
  let candidate = name;
  for (let k = 2; used.has(candidate); k++) candidate = `${name}_${k}`;
  used.add(candidate);
  return candidate;
}
