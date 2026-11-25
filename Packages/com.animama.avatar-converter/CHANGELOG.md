# Changelog

## 0.2.0 (unreleased)

- Convert a MikuMikuDance model (`.pmx`) to VRM 1.0 without Unity:
  `npx animama-avatar-converter model.pmx`. Adapted from pmx-to-vrm (MIT).
  - Materials become MToon with MMD's toon shading, outlines and `.spa`
    matcaps.
  - Every face morph is kept by name. MMD's standard faces and common English,
    Chinese and Korean names become VRM's blink, vowels and five moods,
    composed by brows, eyes and mouth. Group, bone and material morphs convert
    too.
  - Rigid-body physics becomes springs and colliders, and the eye bones (or eye
    meshes) give look-at.
  - `--expression` chooses the morphs a face plays.
  - The VRM marks itself as converted (`ANIMAMA_avatar_conversion`), so an
    Animama that knows the marker plays its springs as tuned.
- The Unity package is unchanged; its version moves with the command's.

## 0.1.1 (2026-11-07)

- Humanoid bones mapped to helper bones that move no part of the model, such
  as dummy thumbs, now map to the bones beside them that the mesh follows, so
  their motion shows in the VRM. The report lists each remap, and warns about
  bones it can't remap.

## 0.1.0 (2026-11-02)

- Export a VRChat Avatar prefab to VRM 1.0 for Animama from **Animama > Export
  for Animama…**, with Mochiya's report explained in plain language.
- Requirement checks and a one-step installer for UniGLTF, UniVRM 1.0 and
  Mochiya Avatar Tools.
- Batch entry points for the `animama-avatar-converter` command line.
