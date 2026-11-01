# Animama Avatar Converter

Convert a VRChat Avatar you own into a VRM file for [Animama](https://animama.ai).
It runs on your computer and uploads nothing.

> Convert only an Avatar whose licence allows it, and share the VRM only if the
> licence allows that too.

**[In Unity](#in-unity)** · **[From a terminal](#from-a-terminal)**

## You need

- The Avatar's VRChat project, set up as its author describes (Unity 2022.3).
- [Git](https://git-scm.com/downloads).
- lilToon 2.3.4 or later (2.x), if the Avatar uses lilToon.

## In Unity

1. In VRChat Creator Companion or ALCOM, add this repository and then add
   **Animama Avatar Converter** to the project:
   `https://raymond-van.github.io/animama-avatar-converter/index.json`
2. In Unity, choose **Install dependencies** when asked.
3. Open **Animama > Export for Animama…**, pick the Avatar's prefab, choose
   where to save, and click **Export**.

## From a terminal

With [Node.js](https://nodejs.org) 22 or later, in the Avatar's project folder:

```bash
npx animama-avatar-converter
```

It adds the converter and its dependencies to the project's
`Packages/manifest.json` if needed, then writes `<Avatar>.vrm` in that folder.
If the project has several Avatar prefabs, it lists them; pass the one you
want:

```bash
npx animama-avatar-converter "Avatar No Jacket"
```

See `npx animama-avatar-converter --help` for options such as `--out`.

## Then

In Animama, choose **Upload VRM** in Create Anima.

## Good to know

- Animator toggles and gesture expressions don't carry over; Animama drives the
  face itself.
- PhysBones become VRM springs: hair and clothes still move, but can't be
  grabbed or stretched.
- Jaw-bone lip sync isn't converted.
- Vertex colours aren't converted, so some lilToon outlines look slightly
  heavier.
- Avatars that need a Modular Avatar build aren't supported yet.
- In Unity, **Animama > Check Requirements…** shows anything missing.

## License

MIT. Built on [Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools)
and [UniVRM](https://github.com/vrm-c/UniVRM), both MIT.
