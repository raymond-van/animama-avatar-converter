# Animama Avatar Converter

Convert a VRChat Avatar you own into a VRM file for [Animama](https://animama.ai).
It runs on your computer and uploads nothing.

> Convert only an Avatar whose licence allows it, and share the VRM only if the
> licence allows that too.

## 1. Prerequisites

- The Avatar's VRChat project, set up as its author describes (Unity 2022.3).
- [Git](https://git-scm.com/downloads).
- lilToon 2.3.4 or later (2.x), if the Avatar uses lilToon.
- To convert from a terminal: [Node.js](https://nodejs.org) 22 or later.

## 2. Convert

<details>
<summary><b>In Unity</b></summary>

1. In VRChat Creator Companion or ALCOM, add this repository:
   `https://raymond-van.github.io/animama-avatar-converter/index.json`
2. Add **Animama Avatar Converter** to the Avatar's project.
3. Open the project in Unity.
4. When asked, click **Install dependencies** and wait for Unity to finish.
5. Choose **Animama > Export for Animama…**.
6. Pick the Avatar's prefab and where to save the VRM.
7. Click **Export**.

</details>

<details>
<summary><b>From a terminal</b></summary>

1. Open a terminal in the Avatar's project folder.
2. Run:

   ```bash
   npx animama-avatar-converter
   ```

3. If the project has several Avatars, the command lists them. Run it again
   with the one you want:

   ```bash
   npx animama-avatar-converter "Avatar No Jacket"
   ```

The VRM is saved as `<Avatar>.vrm` in the project folder. Run
`npx animama-avatar-converter --help` for options such as `--out`.

</details>

Then, in Animama, choose **Upload VRM** in Create Anima.

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
