# Animama Avatar Converter

Convert a VRChat Avatar you own into a VRM file for [Animama](https://animama.ai).
Everything runs on your computer; nothing is uploaded.

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

# Reference

## Options

These work the same on Windows and macOS.

| Option                                           | What it does                                          |
| ------------------------------------------------ | ----------------------------------------------------- |
| `--out <file.vrm>`                               | Where to save the VRM                                 |
| `--name`, `--version`, `--author`, `--copyright` | VRM details (the name defaults to the prefab's)       |
| `--keep-pose`                                    | Keep the modelled pose instead of the T-pose          |
| `--validate`                                     | Check that the Avatar can be converted; write no VRM  |
| `--project <folder>`                             | Use another project folder instead of the current one |
| `--unity <editor>`                               | Use a specific Unity editor                           |

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
- **Jaw-bone lip sync.**
- **Vertex colours**, so some lilToon outlines look slightly heavier.
- **Avatars that need a Modular Avatar build** aren't supported yet.

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
and [UniVRM](https://github.com/vrm-c/UniVRM), both MIT.

[vcc]: https://vcc.docs.vrchat.com
[vpm-cli]: https://vcc.docs.vrchat.com/vpm/cli/
[alcom]: https://vrc-get.anatawa12.com/alcom/
[hub]: https://unity.com/download
[git-win]: https://git-scm.com/download/win
[dotnet]: https://dotnet.microsoft.com/download/dotnet/8.0
[node]: https://nodejs.org
[brew]: https://brew.sh
