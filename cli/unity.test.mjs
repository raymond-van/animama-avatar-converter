import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  exportArgs,
  exportLines,
  projectEditorVersion,
  readSecondaryInstallPath,
  requirementArgs,
  unityEditorCandidates,
  unityProblem,
} from "./unity.mjs";

test("Unity Hub's editor folders on macOS, Windows and Linux, then its custom folder", () => {
  assert.deepEqual(
    unityEditorCandidates("2022.3.62f3", {
      platform: "darwin",
      home: "/Users/a",
      secondaryInstall: "/Volumes/X/Unity",
    }),
    [
      "/Applications/Unity/Hub/Editor/2022.3.62f3/Unity.app/Contents/MacOS/Unity",
      "/Volumes/X/Unity/2022.3.62f3/Unity.app/Contents/MacOS/Unity",
    ],
  );
  assert.deepEqual(
    unityEditorCandidates("2022.3.62f3", {
      platform: "win32",
      home: "C:\\Users\\a",
      secondaryInstall: "D:\\Unity Editors",
    }),
    [
      "C:\\Program Files\\Unity\\Hub\\Editor\\2022.3.62f3\\Editor\\Unity.exe",
      "D:\\Unity Editors\\2022.3.62f3\\Editor\\Unity.exe",
    ],
  );
  assert.deepEqual(
    unityEditorCandidates("2022.3.62f3", {
      platform: "linux",
      home: "/home/a",
      secondaryInstall: null,
    }),
    ["/home/a/Unity/Hub/Editor/2022.3.62f3/Editor/Unity"],
  );
});

test("the project's editor version", () => {
  assert.equal(
    projectEditorVersion(
      "m_EditorVersion: 2022.3.22f1\r\nm_EditorVersionWithRevision: x",
    ),
    "2022.3.22f1",
  );
  assert.equal(projectEditorVersion(""), null);
});

test("Unity runs the batch export with the GPU and only the arguments given", () => {
  const args = exportArgs({
    project: "/p",
    prefab: "Assets/A B.prefab",
    out: "/o/A.vrm",
    log: "/o/A.export.log",
    meta: { name: "A", author: "Me", copyright: "" },
    keepPose: true,
    validate: false,
  });
  assert.deepEqual(args, [
    "-batchmode",
    "-quit",
    "-projectPath",
    "/p",
    "-logFile",
    "/o/A.export.log",
    "-executeMethod",
    "Animama.AvatarExport.BatchExport.Export",
    "-animamaPrefab",
    "Assets/A B.prefab",
    "-animamaOut",
    "/o/A.vrm",
    "-animamaName",
    "A",
    "-animamaAuthor",
    "Me",
    "-animamaKeepPose",
  ]);
  assert.ok(!args.includes("-nographics"));
  const validate = exportArgs({
    project: "/p",
    prefab: "Assets/A.prefab",
    out: null,
    log: "/l",
    meta: {},
    keepPose: false,
    validate: true,
  });
  assert.ok(validate.includes("Animama.AvatarExport.BatchExport.Validate"));
  assert.ok(!validate.includes("-animamaOut"));
  assert.ok(
    requirementArgs({ project: "/p", log: "/l" }).includes(
      "Animama.AvatarExport.BatchRequirements.Check",
    ),
  );
});

test("the log summary keeps every package line and the whole Validate report", () => {
  const log = [
    "Loading packages",
    "[Animama] Applied the humanoid T-pose.",
    "[Animama] Validate:",
    "Warning: Hair: PhysBone motion is approximated with VRM springs.",
    "Unsupported: Body: custom VRChat Animator state machines are not executed by VRM.",
    "UnityEngine.StackTraceUtility:ExtractStackTrace ()",
    "Other output",
    "[Animama] Wrote /o/A.vrm (10 bytes)",
  ].join("\r\n");
  assert.equal(
    exportLines(log),
    [
      "[Animama] Applied the humanoid T-pose.",
      "[Animama] Validate:",
      "  Warning: Hair: PhysBone motion is approximated with VRM springs.",
      "  Unsupported: Body: custom VRChat Animator state machines are not executed by VRM.",
      "[Animama] Wrote /o/A.vrm (10 bytes)",
    ].join("\n"),
  );
});

test("recognizes an open project and missing export code in the Unity log", () => {
  assert.equal(
    unityProblem(
      "It looks like another Unity instance is running with this project open.",
    ),
    "projectOpen",
  );
  assert.equal(
    unityProblem("executeMethod class 'BatchExport' could not be found."),
    "notCompiled",
  );
  assert.equal(unityProblem("Exiting batchmode successfully now!"), null);
});

test("reads Unity Hub's custom install folder from its preferences", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "animama-home-"));
  try {
    assert.equal(
      await readSecondaryInstallPath({ platform: "darwin", home }),
      null,
    );
    const hub = path.join(home, "Library/Application Support/UnityHub");
    mkdirSync(hub, { recursive: true });
    writeFileSync(
      path.join(hub, "secondaryInstallPath.json"),
      JSON.stringify("/Volumes/X/Unity"),
    );
    assert.equal(
      await readSecondaryInstallPath({ platform: "darwin", home }),
      "/Volumes/X/Unity",
    );
    writeFileSync(
      path.join(hub, "secondaryInstallPath.json"),
      JSON.stringify(""),
    );
    assert.equal(
      await readSecondaryInstallPath({ platform: "darwin", home }),
      null,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
