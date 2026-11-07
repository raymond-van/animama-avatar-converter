# Changelog

## Unreleased

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
