# Animama Avatar Export

Export a VRChat Avatar you own to a VRM file for [Animama](https://animama.ai),
from a Unity menu or from a terminal. The conversion runs on your computer
through [Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools)
and [UniVRM](https://github.com/vrm-c/UniVRM). Nothing is uploaded.

**Convert only an Avatar whose licence allows you to convert it for your own
use.** Many Avatar licences, such as VN3, forbid sharing the Avatar or edited
versions of it. Do not share the exported VRM unless the Avatar's licence allows
it.

## What you need

- The Avatar's Unity project, set up as its author describes, in a VRChat
  Avatars project made with VRChat Creator Companion (VCC) or ALCOM.
- Unity 2022.3, the editor VRChat uses, installed through Unity Hub.
- [Git](https://git-scm.com/downloads), which Unity uses to install the
  converter's dependencies. Restart Unity Hub after installing it.
- lilToon 2.3.4 or later within 2.x, if the Avatar uses lilToon. Avatars that ship an older
  lilToon (for example 1.4.0) need it replaced first: delete `Assets/lilToon`
  and add lilToon from its repository,
  `https://lilxyzw.github.io/vpm-repos/vpm.json`. Take screenshots of the Avatar
  before, since its look can change.

The export has been tested on macOS with Unity 2022.3.62f3.

## Install

In VCC or ALCOM, add this repository, then add **Animama Avatar Export** to the
Avatar's project:

```text
https://raymond-van.github.io/animama-avatar-export/index.json
```

Without VCC, open **Window > Package Manager > + > Add package from git URL** in
Unity and enter:

```text
https://github.com/raymond-van/animama-avatar-export.git?path=/Packages/com.animama.avatar-export#v0.1.0
```

Or download the zip from the
[releases page](https://github.com/raymond-van/animama-avatar-export/releases),
extract it to a permanent folder outside the project's `Assets`, and choose
**Add package from disk…** with its `package.json`.

When Unity has compiled it, the **Animama Avatar Export Setup** window opens and
lists what the project still needs. Choose **Install dependencies**: after you
confirm, it adds UniGLTF and UniVRM 1.0 0.131.2 and Mochiya Avatar Tools at its
tested version to `Packages/manifest.json`, and Unity downloads them. Open the
window again with **Animama > Check Requirements…**.

## Export

1. Open **Animama > Export for Animama…**.
2. Choose the Avatar's prefab. Many Avatars ship variants, such as one without
   a jacket; each export captures the prefab you choose. You can also choose the
   Avatar in the open scene if it has no changes its prefab lacks.
3. Check the VRM details (name, version, author, copyright), and choose where to
   save the file with **Choose…** beside **Save as**. The export never replaces
   an existing file.
4. Choose **Validate** to see what will be converted, then **Export**. The first
   export in a project shows the licence notice.

The export works in a temporary scene and reopens your scenes afterwards, so it
asks you to save unsaved changes first. It leaves the Avatar's prefab unchanged.

It removes objects tagged `EditorOnly`, as VRChat does when it builds the Avatar,
and poses the Avatar in the T-pose VRM 1.0 expects. **Keep modelled pose**
exports the pose it was modelled in instead; Animama straightens A-pose arms
when it loads them, but other VRM apps may not.

### What the validation report means

- **Animator logic is not converted.** Gesture expressions and outfit toggles
  do not carry over; Animama drives the face itself.
- **Mouth shapes, blinking and eye movement carry over** as VRM expressions and
  look-at.
- **PhysBones become VRM springs.** Hair and clothes still move, but cannot be
  grabbed or stretched, angle limits are dropped, and gravity falloff is baked
  in, so some springs hang slightly differently than in VRChat.
- **Some colliders are simplified.** Plane colliders are left out, and inside
  colliders become outside colliders.

Errors stop the export. Mochiya rejects lilToon's Lite, Multi, FurOnly and
tessellation shader variants.

### Known limits

- Vertex colours are not exported, so lilToon outlines that use them (common on
  hair) draw slightly heavier.
- Lip sync driven by a jaw bone or parameters is not converted, and the report
  does not warn about it; only blendshape visemes carry over.
- Blendshapes the Avatar keeps at a non-zero weight in Unity are exported at
  zero, so a part they adjust can sit differently.
- Avatars that need a Modular Avatar build are not supported yet; the window
  and the command say so.

## Use it in Animama

In Animama, choose **Upload VRM** in Create Anima and pick the exported file.
Files up to 100 MiB are accepted.

## From a terminal

With [Node.js](https://nodejs.org) 22 or later, close the project in Unity and
run:

```bash
npx github:raymond-van/animama-avatar-export#v0.1.0 --project <unity-project> --prefab "Assets/<Avatar>/<Avatar>.prefab" --out <folder>/<Avatar>.vrm
```

The command adds the package and its dependencies to the project's
`Packages/manifest.json` if they are missing, runs Unity in batch mode with the
same export as the window, and prints the validation report. Unity's log is
written beside the output as `<Avatar>.export.log` (with `--validate` and no
`--out`, to the project's `Logs/animama-validate.log`; `--log` chooses another
file). If the package's export code did not compile, a second Unity run checks
the requirements and logs to `<Avatar>.export.requirements.log`.

| Option | Meaning |
| --- | --- |
| `--name`, `--version`, `--author`, `--copyright` | VRM details; the name defaults to the prefab's |
| `--keep-pose` | Export the modelled pose instead of the T-pose |
| `--validate` | Validate only; `--out` is optional |
| `--unity <editor>` | The Unity editor to run; by default the project's version from Unity Hub, or `ANIMAMA_UNITY_EDITOR` |
| `--log <file>` | Where to write Unity's log instead |

It exits with 0 when the VRM was written (or `--validate` passed), 2 when
Mochiya cannot convert the prefab or it needs a Modular Avatar build, and 1
otherwise, including a project that misses a requirement. It refuses while the project is open in Unity, and stops
if `Packages/manifest.json` pins other versions of the dependencies.

Unity must run with a graphics device: the exporter reads textures back through
the GPU and writes flat grey textures without one.

## Troubleshooting

- **"The package's export code did not compile"**, or no **Export for Animama**
  window: open **Animama > Check Requirements…** and fix what it lists.
- **Unity cannot install the dependencies:** install Git, restart Unity Hub and
  Unity, and choose **Install dependencies** again.
- **The export asks you to save:** save the scene, or reload it to discard the
  changes; the export reopens your saved scenes afterwards.

## Releasing

Maintainers release by pushing one version tag at a time, `v<version>`, on
`main`, after updating both `package.json` files, the install lines in this
README and the package's `CHANGELOG.md` heading. The release workflow checks
these, creates the GitHub release with the package zip and rebuilds the
listing from every release's zip. A failed job can be re-run on its own: an
existing release is kept unchanged. Never move or delete a published tag;
ship a fix as a new patch version.

The repository needs:

- GitHub Pages with the source set to **GitHub Actions**;
- the `github-pages` environment allowing deployments from tags matching
  `v*` (optionally with a required reviewer);
- a tag ruleset that blocks updating and deleting `v*` tags.

## Repository layout

- `Packages/com.animama.avatar-export/`: the Unity editor package.
- `cli/`: the command line (no npm dependencies).
- `scripts/`: repository checks, the package zip and the listing build.

## License

MIT. See [LICENSE](LICENSE). Mochiya Avatar Tools and UniVRM are separate
projects under their own MIT licences.
