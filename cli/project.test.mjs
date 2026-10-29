import assert from "node:assert/strict";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEPENDENCIES,
  embeddedPackages,
  PACKAGE_NAME,
  planManifest,
  projectIsOpen,
  releasedPackageSpec,
} from "./project.mjs";

const SPEC = releasedPackageSpec("0.1.0");

test("adds the package and its dependencies, keeping indentation and line endings", () => {
  const text =
    '{\r\n    "dependencies": {\r\n        "com.vrchat.avatars": "3.7.6"\r\n    }\r\n}\r\n';

  const plan = planManifest(text, SPEC);

  assert.deepEqual(plan.added, [...Object.keys(DEPENDENCIES), PACKAGE_NAME]);
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.text.endsWith("}\r\n"));
  assert.ok(!/[^\r]\n/.test(plan.text), "every line ends in CRLF");
  assert.ok(
    plan.text.includes('\r\n        "com.vrmc.vrm": '),
    "four-space indent kept",
  );
  const manifest = JSON.parse(plan.text);
  assert.equal(manifest.dependencies["com.vrchat.avatars"], "3.7.6");
  assert.equal(manifest.dependencies[PACKAGE_NAME], SPEC);
  assert.equal(
    manifest.dependencies["org.mochiya.avatar-tools"],
    DEPENDENCIES["org.mochiya.avatar-tools"],
  );
});

test("a ready manifest is left alone, including UniVRM from another source", () => {
  const text =
    JSON.stringify(
      {
        dependencies: {
          ...DEPENDENCIES,
          "com.vrmc.gltf": "0.131.2",
          [PACKAGE_NAME]: SPEC,
        },
      },
      null,
      2,
    ) + "\n";

  assert.deepEqual(planManifest(text, SPEC), {
    text: null,
    added: [],
    conflicts: [],
  });
});

test("entries that pin other versions are reported, not replaced", () => {
  const text = JSON.stringify(
    {
      dependencies: {
        "com.vrmc.vrm":
          "https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v0.128.0",
        "org.mochiya.avatar-tools":
          "https://github.com/mochiya-labs/unity-avatar-tools.git",
        [PACKAGE_NAME]: releasedPackageSpec("0.0.9"),
      },
    },
    null,
    2,
  );

  const plan = planManifest(text, SPEC);

  assert.equal(plan.text, null);
  assert.deepEqual(plan.added, []);
  assert.deepEqual(
    plan.conflicts.map((conflict) => conflict.name),
    ["com.vrmc.vrm", "org.mochiya.avatar-tools", PACKAGE_NAME],
  );
  assert.equal(plan.conflicts[0].wanted, DEPENDENCIES["com.vrmc.vrm"]);
});

test("the released package is installed from its tag", () => {
  assert.equal(
    releasedPackageSpec("0.1.0"),
    "https://github.com/raymond-van/animama-avatar-export.git?path=/Packages/com.animama.avatar-export#v0.1.0",
  );
});

test("a project without a Unity lockfile, or with one nobody holds, is not open", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "animama-project-"));
  try {
    assert.equal(projectIsOpen(project), false);
    mkdirSync(path.join(project, "Temp"));
    writeFileSync(path.join(project, "Temp", "UnityLockfile"), "");
    assert.equal(
      projectIsOpen(project),
      false,
      "a leftover lockfile from a crash",
    );
    if (process.platform !== "win32") {
      // lsof reports any process holding the file, as Unity does while it runs.
      const held = openSync(path.join(project, "Temp", "UnityLockfile"), "r");
      try {
        assert.equal(projectIsOpen(project), true);
      } finally {
        closeSync(held);
      }
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("embedded packages count as present; an old UniVRM 0.x entry is reported", () => {
  const text =
    JSON.stringify(
      { dependencies: { "com.vrmc.univrm": "0.128.0" } },
      null,
      2,
    ) + "\n";

  const plan = planManifest(
    text,
    SPEC,
    new Set([PACKAGE_NAME, "org.mochiya.avatar-tools"]),
  );

  assert.deepEqual(plan.conflicts, [
    { name: "com.vrmc.univrm", found: "0.128.0", wanted: "0.131.2" },
  ]);
  const ready = planManifest(
    '{\n  "dependencies": {}\n}\n',
    SPEC,
    new Set([PACKAGE_NAME, "org.mochiya.avatar-tools"]),
  );
  assert.deepEqual(ready.added, ["com.vrmc.gltf", "com.vrmc.vrm"]);
  assert.ok(!/\r/.test(ready.text), "LF kept");
  assert.ok(ready.text.endsWith("}\n"));
});

test("finds packages embedded in the Packages folder", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "animama-project-"));
  try {
    mkdirSync(path.join(project, "Packages", "com.vrchat.avatars"), {
      recursive: true,
    });
    writeFileSync(
      path.join(project, "Packages", "com.vrchat.avatars", "package.json"),
      "{}",
    );
    mkdirSync(path.join(project, "Packages", "not-a-package"));
    writeFileSync(path.join(project, "Packages", "manifest.json"), "{}");
    assert.deepEqual([...embeddedPackages(project)], ["com.vrchat.avatars"]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a byte-order mark is kept, and invalid JSON names the file", () => {
  const plan = planManifest('\uFEFF{\n  "dependencies": {}\n}\n', SPEC);
  assert.ok(plan.text.startsWith("\uFEFF{"));
  assert.throws(
    () => planManifest("{ nope", SPEC),
    /Packages\/manifest\.json is not valid JSON/,
  );
});

test("on Windows, an unheld lockfile is not an open project", () => {
  const project = mkdtempSync(path.join(os.tmpdir(), "animama-project-"));
  try {
    mkdirSync(path.join(project, "Temp"));
    writeFileSync(path.join(project, "Temp", "UnityLockfile"), "");
    assert.equal(projectIsOpen(project, "win32"), false);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
