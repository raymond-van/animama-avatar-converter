# Animama Avatar Converter

Convert a VRChat Avatar or a MikuMikuDance (MMD) model you own into a VRM file
for [Animama](https://animama.ai). Everything runs on your computer; nothing is
uploaded.

> [!IMPORTANT]
> Convert only an Avatar whose licence allows it, and share the VRM only if the
> licence allows that too.

# Instructions

Open the section for your system below. Each one offers two ways to convert;
both produce the same VRM:

|                    | In Unity                                      | From a terminal                           |
| ------------------ | --------------------------------------------- | ----------------------------------------- |
| Best for           | Your first conversion, or if you prefer menus | Repeat exports, or several Avatars        |
| How it works       | A window inside Unity with buttons            | One command; Unity runs in the background |
| Extra requirements | None                                          | Node.js 22 or later; Unity must be closed |

After converting: [use the VRM in Animama](#use-the-vrm-in-animama) ·
[what doesn't carry over](#what-doesnt-carry-over) ·
[troubleshooting](#troubleshooting)

Converting an MMD model (`.pmx`) needs no Unity: see [MMD models](#mmd-models).

<details>
<summary><h2>Windows</h2></summary>

### Set up

1. **The Avatar's project.** Create it with [VRChat Creator Companion
   (VCC)][vcc] and set it up as the Avatar's author describes. It must use
   **Unity 2022.3**; install it through [Unity Hub][hub] when VCC asks.
2. **Git.** Install [Git for Windows][git-win] with the default options, then
   **restart Unity Hub** so it finds Git.
3. **lilToon** (only if the Avatar uses it): version **2.3.4 or later** (2.x).
   Update it in VCC if the project has an older one.

### Convert

Choose one way:

<details>
<summary><b>Convert in Unity</b></summary>

1. In VCC, choose **Settings › Packages › Add Repository** and add:

   ```text
   https://raymond-van.github.io/animama-avatar-converter/index.json
   ```

2. Open the Avatar's project in VCC and add **Animama Avatar Converter**.
3. Open the project in Unity.
4. A window titled _Animama Avatar Converter Setup_ appears. Click **Install
   dependencies** and wait until Unity finishes compiling.
5. Choose **Animama › Export for Animama…**
6. Drag the Avatar's prefab into the **Avatar** field.
7. Click **Choose…** beside **Save as** and pick where to save the VRM.
8. Click **Export** and accept the licence notice.

When it finishes, click **Show in Explorer** to find the VRM, then [use it in
Animama](#use-the-vrm-in-animama).

</details>

<details>
<summary><b>Convert from a terminal</b></summary>

You don't need to add the package in VCC: the first run adds the converter and
its dependencies to the project's `Packages/manifest.json`.

1. Install [Node.js][node] (22 or later). In Terminal, run:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. Close the project in Unity.
3. In File Explorer, open the Avatar's project folder (the one with `Assets`,
   `Packages` and `ProjectSettings`). Right-click an empty area and choose
   **Open in Terminal**.
4. Run:

   ```powershell
   npx animama-avatar-converter
   ```

   If the project has several Avatars, the command lists them. Run it again with
   the one you want, in quotes if the name has spaces:

   ```powershell
   npx animama-avatar-converter "Avatar No Jacket"
   ```

The VRM is saved in the project folder as `<Avatar name>.vrm`. See
[Options](#options) to change the file name or VRM details, then [use it in
Animama](#use-the-vrm-in-animama).

</details>

</details>

<details>
<summary><h2>macOS</h2></summary>

VRChat Creator Companion doesn't run on macOS. This guide uses VRChat's
[VPM CLI][vpm-cli], the command-line version of VCC. If you prefer a window
with buttons, [ALCOM][alcom] does the same jobs.

### Set up

1. **Git.** In Terminal, run:

   ```bash
   xcode-select --install
   ```

2. **Unity.** Install [Unity Hub][hub] in `/Applications`, then use it to
   install **Unity 2022.3**.
3. **The VPM CLI.** Install the [.NET 8 SDK][dotnet], then run:

   ```bash
   dotnet tool install --global vrchat.vpm.cli
   vpm install templates
   vpm check hub
   vpm check unity
   ```

   Both checks should find Unity Hub and Unity 2022.3.

4. **The Avatar's project.** Set it up as the Avatar's author describes. To
   start a new VRChat Avatar project:

   ```bash
   vpm new "My Avatar" Avatar -p ~/VRChat
   ```

5. **lilToon** (only if the Avatar uses it): version **2.3.4 or later** (2.x).

### Convert

Choose one way:

<details>
<summary><b>Convert in Unity</b></summary>

1. Add the converter to the Avatar's project. Replace the path with your
   project's folder:

   ```bash
   vpm add repo https://raymond-van.github.io/animama-avatar-converter/index.json
   vpm add package com.animama.avatar-converter -p ~/VRChat/"My Avatar"
   ```

2. Open the project in Unity through Unity Hub.
3. A window titled _Animama Avatar Converter Setup_ appears. Click **Install
   dependencies** and wait until Unity finishes compiling.
4. Choose **Animama › Export for Animama…**
5. Drag the Avatar's prefab into the **Avatar** field.
6. Click **Choose…** beside **Save as** and pick where to save the VRM.
7. Click **Export** and accept the licence notice.

When it finishes, click **Show in Finder** to find the VRM, then [use it in
Animama](#use-the-vrm-in-animama).

</details>

<details>
<summary><b>Convert from a terminal</b></summary>

You don't need to add the package with VPM: the first run adds the converter
and its dependencies to the project's `Packages/manifest.json`.

1. Install [Node.js][node] (22 or later). With [Homebrew][brew], run:

   ```bash
   brew install node
   ```

   Without Homebrew, use the macOS installer from [nodejs.org][node].

2. Close the project in Unity.
3. Open **Terminal** and go to the Avatar's project folder (the one with
   `Assets`, `Packages` and `ProjectSettings`). Type `cd ` with a space, drag
   the folder from Finder into the window, then press **Return**.
4. Run:

   ```bash
   npx animama-avatar-converter
   ```

   If the project has several Avatars, the command lists them. Run it again with
   the one you want, in quotes if the name has spaces:

   ```bash
   npx animama-avatar-converter "Avatar No Jacket"
   ```

The VRM is saved in the project folder as `<Avatar name>.vrm`. See
[Options](#options) to change the file name or VRM details, then [use it in
Animama](#use-the-vrm-in-animama).

</details>

</details>

# MMD models

MikuMikuDance models (`.pmx`) convert without Unity, from version 0.2.0 of the
command. You need [Node.js][node] 22 or later. The older PMD format (`.pmd`)
isn't supported: save the model as `.pmx` in PMX Editor first.

1. Keep the model's folder as it came, so its textures are where the `.pmx`
   expects them.
2. In a terminal, run the command with the `.pmx` file:

   ```bash
   npx animama-avatar-converter path/to/model.pmx
   ```

   The VRM is saved beside the model as `model.vrm`. Use `--out` to save it
   elsewhere and `--validate` to check the model without writing anything.

3. [Use the VRM in Animama](#use-the-vrm-in-animama).

The report lists what was converted and anything left out.

What converts:

- **Materials** become MToon with MMD's toon shading, outlines and `.spa`
  matcaps.
- **Face morphs** are all kept under their own names. MMD's standard faces
  (まばたき, あいうえお, 笑い, 困る, 怒り …) and common English, Chinese and
  Korean names become VRM's blink, vowels and moods, with the brows, eyes and
  mouth composed separately. Group, bone and material morphs work too.
- **Physics** (rigid bodies) becomes springs on hair, skirts and accessories,
  with colliders from the body.
- **Eye look-at** comes from the eye bones (左目, 右目), or from the eye meshes
  when the bones can't turn them.
- The model is scaled to metres and stood in a T-pose.

What doesn't carry over:

- IK and other bones that only drive animation in MMD;
- physics joints between neighbouring chains (skirts move chain by chain), and
  PMX 2.1 soft bodies;
- multiplicative (`.sph`) and sub-texture sphere maps, specular highlights,
  outline transparency and per-vertex outline width;
- SDEF skinning, which becomes ordinary skinning;
- flip, impulse and uneven UV morphs, material morphs that brighten a texture,
  and fades of the whole model at once;
- eye look-at for eyes painted on the face.

The report counts most of these, and says why a model gets no look-at.

**Choosing the faces.** If a face looks wrong, pick its morphs yourself with
`--expression`, once per face, then convert again:

```bash
npx animama-avatar-converter model.pmx --expression "sad=困る+口角下げ*0.6" --expression "Fcl_EYE_Joy=笑い"
```

- A name is a VRM preset (`aa`, `ih`, `ou`, `ee`, `oh`, `blink`, `blinkLeft`,
  `blinkRight`, `happy`, `relaxed`, `sad`, `angry`, `surprised`), or one region
  of a mood: `Fcl_<BRW|EYE|MTH>_<mood>` for the brows, eyes or mouth, where the
  mood is `Joy` (happy), `Fun` (relaxed), `Sorrow`, `Angry` or `Surprised`.
- Give a mood's preset or its regions, not both.
- The morphs are the model's face morphs, by their names in the model;
  material and UV morphs can't be chosen. A weight after `*` is between 0 and 1,
  and `sad=` leaves that face still.

# Reference

## Options

These work the same on Windows and macOS.

| Option                                           | What it does                                               |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `--out <file.vrm>`                               | Where to save the VRM                                      |
| `--name`, `--version`, `--author`, `--copyright` | VRM details (the name defaults to the prefab's or model's) |
| `--keep-pose`                                    | Keep the modelled pose instead of the T-pose               |
| `--validate`                                     | Check that it can be converted; write no VRM               |
| `--expression <name>=<morph>[*<weight>][+…]`     | MMD models: choose the morphs a face plays                 |
| `--project <folder>`                             | Unity: use another project folder                          |
| `--unity <editor>`                               | Unity: use a specific Unity editor                         |

The command never overwrites a file. Unity's log is saved beside the VRM as
`<Avatar name>.export.log`. Run `npx animama-avatar-converter --help` for the
full list.

## Use the VRM in Animama

In Animama, open **Create Anima**, choose **Upload VRM** and pick the `.vrm`
file.

## What doesn't carry over

- **Toggles and gesture expressions** from the Animator. Animama drives the
  face itself.
- **PhysBones** become VRM springs: hair and clothes still move, but can't be
  grabbed or stretched.
- **Shaders other than lilToon**, such as Poiyomi. Those materials keep only
  their main texture and colour, so the Avatar looks flatter: toon shading,
  outlines, emission and matcaps are lost.
- **Jaw-bone lip sync.**
- **Vertex colours**, so some lilToon outlines look slightly heavier.
- **Avatars that need a Modular Avatar build** aren't supported yet.

Some Avatars map humanoid bones, often the thumbs, to helper bones that move
no part of the model, while the mesh follows bones beside them. The converter
maps those humanoid bones to the bones the mesh follows and lists them in the
report. If it can't find such a bone, the report names the humanoid bones whose
motion won't show.

Other Unity humanoid models convert too, but without a VRChat avatar
descriptor the VRM has no lip sync, blinking or eye movement. From a terminal,
pass the model's prefab name, since only VRChat Avatars are found automatically.

## Troubleshooting

**Unity says Git is required.** Install Git (see **Set up** for your system),
restart Unity Hub and Unity, then
try again.

**Something is missing or the wrong version.** In Unity, choose **Animama ›
Check Requirements…** to see each requirement and install what is missing.

**The terminal says "The project is open in Unity."** Close Unity and run the
command again.

**The terminal says Unity was not found.** The command looks for the project's
Unity version in Unity Hub's install folders. Install that version from Unity
Hub, or point the command at the editor with `--unity`:

```powershell
# Windows
npx animama-avatar-converter --unity "C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe"
```

```bash
# macOS
npx animama-avatar-converter --unity "/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity"
```

**The terminal says the Avatar can't be exported.** The report above that
message lists why; the full log is in `<Avatar name>.export.log`.

## License

MIT. Built on [Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools)
and [UniVRM](https://github.com/vrm-c/UniVRM), both MIT. The MMD (PMX) converter
is adapted from [pmx-to-vrm](https://github.com/GoldenCarrotMLP/pmx-to-vrm)
(MIT; its notice is in `pmx/LICENSE-pmx-to-vrm`).

[vcc]: https://vcc.docs.vrchat.com
[vpm-cli]: https://vcc.docs.vrchat.com/vpm/cli/
[alcom]: https://vrc-get.anatawa12.com/alcom/
[hub]: https://unity.com/download
[git-win]: https://git-scm.com/download/win
[dotnet]: https://dotnet.microsoft.com/download/dotnet/8.0
[node]: https://nodejs.org
[brew]: https://brew.sh
