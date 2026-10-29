import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "./main.mjs";
import { PACKAGE_NAME } from "./project.mjs";

/** A temporary Unity project and output folder, and a fake Unity that writes a scripted log. */
function setup({
  exitCode = 0,
  logLines = [],
  writeVrm = true,
  manifest,
  requirementLines = [
    "[Animama] Requirement missing: UniVRM 1.0: found not installed, requires 0.131.2.",
  ],
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "animama-cli-"));
  const project = path.join(root, "Project");
  mkdirSync(path.join(project, "ProjectSettings"), { recursive: true });
  mkdirSync(path.join(project, "Packages"));
  writeFileSync(
    path.join(project, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 2022.3.62f3\n",
  );
  writeFileSync(
    path.join(project, "Packages", "manifest.json"),
    manifest ?? '{\n  "dependencies": {}\n}\n',
  );
  const out = path.join(root, "Out", "Avatar.vrm");
  mkdirSync(path.dirname(out));
  const editor = path.join(root, "Unity");
  writeFileSync(editor, "");
  const calls = [];
  const output = [];
  const io = {
    log: (line) => output.push(line),
    error: (line) => output.push(`error: ${line}`),
    env: { ANIMAMA_UNITY_EDITOR: editor },
    projectIsOpen: () => false,
    runUnity: async (editor, args) => {
      calls.push({ editor, args });
      const log = args[args.indexOf("-logFile") + 1];
      const method = args[args.indexOf("-executeMethod") + 1];
      if (method.endsWith("BatchRequirements.Check")) {
        writeFileSync(log, requirementLines.join("\n"));
        return 3;
      }
      writeFileSync(log, logLines.join("\n"));
      if (writeVrm && exitCode === 0 && method.endsWith(".Export"))
        writeFileSync(args[args.indexOf("-animamaOut") + 1], "vrm");
      return exitCode;
    },
  };
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  return { root, project, out, calls, output, io, cleanup };
}

test("exports through the package after adding it to the manifest", async () => {
  const { project, out, calls, output, io, cleanup } = setup({
    logLines: ["noise", "[Animama] Wrote it"],
  });
  try {
    const code = await main(
      [
        "--project",
        project,
        "--prefab",
        "Assets/A.prefab",
        "--out",
        out,
        "--keep-pose",
      ],
      io,
    );

    assert.equal(code, 0);
    assert.equal(readFileSync(out, "utf8"), "vrm");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].editor.endsWith(`${path.sep}Unity`));
    assert.ok(calls[0].args.includes("-animamaKeepPose"));
    assert.equal(
      calls[0].args[calls[0].args.indexOf("-logFile") + 1],
      out.replace(/\.vrm$/, ".export.log"),
    );
    const manifest = JSON.parse(
      readFileSync(path.join(project, "Packages", "manifest.json"), "utf8"),
    );
    assert.match(manifest.dependencies[PACKAGE_NAME], /#v\d+\.\d+\.\d+$/);
    assert.ok(
      output.some((line) => line.startsWith("Added to Packages/manifest.json")),
    );
    assert.ok(output.includes("[Animama] Wrote it"));
    assert.ok(output.at(-1).startsWith(`Wrote ${out}`));
  } finally {
    cleanup();
  }
});

test("--package replaces the released package, for testing unreleased versions", async () => {
  const { project, out, io, cleanup } = setup();
  try {
    await main(
      [
        "--project",
        project,
        "--prefab",
        "Assets/A.prefab",
        "--out",
        out,
        "--package",
        "file:/src/pkg",
      ],
      io,
    );

    const manifest = JSON.parse(
      readFileSync(path.join(project, "Packages", "manifest.json"), "utf8"),
    );
    assert.equal(manifest.dependencies[PACKAGE_NAME], "file:/src/pkg");
  } finally {
    cleanup();
  }
});

test("never overwrites, and refuses while the project is open, before touching it", async () => {
  const { project, out, calls, io, cleanup } = setup();
  const manifestPath = path.join(project, "Packages", "manifest.json");
  const before = readFileSync(manifestPath, "utf8");
  try {
    writeFileSync(out, "keep");
    await assert.rejects(
      main(["--project", project, "--prefab", "A", "--out", out], io),
      /exists/,
    );
    assert.equal(readFileSync(out, "utf8"), "keep");

    const open = { ...io, projectIsOpen: () => true };
    await assert.rejects(
      main(
        [
          "--project",
          project,
          "--prefab",
          "A",
          "--out",
          out.replace("Avatar", "Other"),
        ],
        open,
      ),
      /open in Unity/,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), before);
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

test("manifest entries pinning other versions stop the run", async () => {
  const manifest = JSON.stringify({
    dependencies: { "com.vrmc.vrm": "0.128.0" },
  });
  const { project, out, calls, io, cleanup } = setup({ manifest });
  try {
    await assert.rejects(
      main(["--project", project, "--prefab", "A", "--out", out], io),
      /"com\.vrmc\.vrm": "0\.128\.0" \(the export needs/,
    );
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

test("a prefab Mochiya cannot convert exits 2 and writes nothing", async () => {
  const { project, out, output, io, cleanup } = setup({
    exitCode: 2,
    logLines: ["[Animama] Validate:", "Error: no humanoid", ""],
  });
  try {
    const code = await main(
      ["--project", project, "--prefab", "A", "--out", out],
      io,
    );

    assert.equal(code, 2);
    assert.equal(existsSync(out), false);
    assert.ok(output.includes("[Animama] Validate:\n  Error: no humanoid"));
  } finally {
    cleanup();
  }
});

test("export code that did not compile is explained by the requirement check", async () => {
  const { project, out, calls, output, io, cleanup } = setup({
    exitCode: 1,
    logLines: [
      // Unity's own wording.
      "executeMethod class 'BatchExport' could not be found.",
    ],
  });
  try {
    const code = await main(
      ["--project", project, "--prefab", "A", "--out", out],
      io,
    );

    assert.equal(code, 1);
    assert.equal(calls.length, 2);
    assert.ok(
      output.some(
        (line) =>
          line.includes("did not compile") && line.includes("UniVRM 1.0"),
      ),
    );
  } finally {
    cleanup();
  }
});

test("validation writes its log in the project when there is no --out", async () => {
  const { project, calls, io, cleanup } = setup({
    logLines: ["[Animama] Validate:", "Warning: ok"],
  });
  try {
    mkdirSync(path.join(project, "Logs"));
    const code = await main(
      ["--project", project, "--prefab", "A", "--validate"],
      io,
    );

    assert.equal(code, 0);
    assert.equal(
      calls[0].args[calls[0].args.indexOf("-logFile") + 1],
      path.join(project, "Logs", "animama-validate.log"),
    );
  } finally {
    cleanup();
  }
});

test("a folder that is not a Unity project is refused", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "animama-cli-"));
  try {
    await assert.rejects(
      main(
        ["--project", root, "--prefab", "A", "--out", path.join(root, "A.vrm")],
        { log: () => {} },
      ),
      /not a Unity project/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a project missing a requirement exits 1 and says so", async () => {
  const { project, out, output, io, cleanup } = setup({
    exitCode: 3,
    logLines: ["[Animama] Requirement not met: lilToon: found 1.4.0"],
  });
  try {
    const code = await main(
      ["--project", project, "--prefab", "A", "--out", out],
      io,
    );

    assert.equal(code, 1);
    assert.ok(
      output.includes("[Animama] Requirement not met: lilToon: found 1.4.0"),
    );
    assert.ok(
      output.some((line) =>
        line.includes("does not meet the export's requirements"),
      ),
    );
  } finally {
    cleanup();
  }
});

test("a package that never loaded is not blamed on its dependencies", async () => {
  const { project, out, output, io, cleanup } = setup({
    exitCode: 1,
    logLines: ["executeMethod class 'BatchExport' could not be found."],
    requirementLines: [
      "executeMethod class 'BatchRequirements' could not be found.",
    ],
  });
  try {
    const code = await main(
      ["--project", project, "--prefab", "A", "--out", out],
      io,
    );

    assert.equal(code, 1);
    assert.ok(
      output.some(
        (line) => line.includes("did not load") && line.includes("--package"),
      ),
    );
  } finally {
    cleanup();
  }
});

test("Unity's own message for an open project is reported", async () => {
  const { project, out, output, io, cleanup } = setup({
    exitCode: 1,
    logLines: [
      "It looks like another Unity instance is running with this project open.",
    ],
  });
  try {
    assert.equal(
      await main(["--project", project, "--prefab", "A", "--out", out], io),
      1,
    );
    assert.ok(
      output.includes(
        "error: The project is open in Unity. Close it, then run again.",
      ),
    );
  } finally {
    cleanup();
  }
});

test("a missing editor or output folder stops the run before the manifest changes", async () => {
  const { root, project, out, calls, io, cleanup } = setup();
  const manifestPath = path.join(project, "Packages", "manifest.json");
  const before = readFileSync(manifestPath, "utf8");
  try {
    const noEditor = {
      ...io,
      env: { ANIMAMA_UNITY_EDITOR: path.join(root, "Missing", "Unity") },
    };
    await assert.rejects(
      main(["--project", project, "--prefab", "A", "--out", out], noEditor),
      /does not exist/,
    );
    await assert.rejects(
      main(
        [
          "--project",
          project,
          "--prefab",
          "A",
          "--out",
          path.join(root, "Nowhere", "A.vrm"),
        ],
        io,
      ),
      /folder .* does not exist/,
    );
    assert.equal(readFileSync(manifestPath, "utf8"), before);
    assert.equal(calls.length, 0);
  } finally {
    cleanup();
  }
});

test("every run starts with the licence reminder", async () => {
  const { project, out, output, io, cleanup } = setup();
  try {
    await main(["--project", project, "--prefab", "A", "--out", out], io);
    assert.match(
      output[0],
      /licence allows you to convert it for your own use/,
    );
  } finally {
    cleanup();
  }
});

test(
  "runs a real Unity executable in a folder with spaces, without a shell",
  { skip: process.platform === "win32" && "POSIX shebang fake" },
  async () => {
    const { root, project, out, cleanup } = setup();
    try {
      const editorDir = path.join(root, "Unity Hub", "Editor 2022");
      mkdirSync(editorDir, { recursive: true });
      const fake = path.join(editorDir, "Unity");
      writeFileSync(
        fake,
        [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          "const args = process.argv.slice(2);",
          "const value = (name) => args[args.indexOf(name) + 1];",
          'fs.writeFileSync(value("-logFile"), "[Animama] prefab " + value("-animamaPrefab") + "\\n");',
          'fs.writeFileSync(value("-animamaOut"), "vrm");',
        ].join("\n"),
      );
      chmodSync(fake, 0o755);
      const output = [];
      const code = await main(
        [
          "--project",
          project,
          "--prefab",
          "Assets/My Avatar/A.prefab",
          "--out",
          out,
          "--unity",
          fake,
        ],
        {
          log: (line) => output.push(line),
          error: (line) => output.push(line),
          env: {},
          projectIsOpen: () => false,
        },
      );

      assert.equal(code, 0);
      assert.ok(output.includes("[Animama] prefab Assets/My Avatar/A.prefab"));
      assert.equal(readFileSync(out, "utf8"), "vrm");
    } finally {
      cleanup();
    }
  },
);
