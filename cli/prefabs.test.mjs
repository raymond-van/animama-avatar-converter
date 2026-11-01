import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findPrefabs, resolvePrefab, variantBaseGuid } from "./prefabs.mjs";

const DESCRIPTOR =
  "  m_Script: {fileID: 542108242, guid: 67cc4cb7839cd3741b63733d5adf0442, type: 3}\n";
const instance = (parent, guid) =>
  `--- !u!1001 &1\nPrefabInstance:\n  m_Modification:\n    m_TransformParent: {fileID: ${parent}}\n  m_SourcePrefab: {fileID: 100100000, guid: ${guid}, type: 3}\n`;
const MAIN = "a".repeat(32);

/** A project with an Avatar, its variant, an outfit that nests the Avatar, and ignored folders. */
function project() {
  const root = mkdtempSync(path.join(os.tmpdir(), "animama-prefabs-"));
  const prefab = (relative, text, guid) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `%YAML 1.1\n${text}`);
    if (guid)
      writeFileSync(`${file}.meta`, `fileFormatVersion: 2\nguid: ${guid}\n`);
  };
  prefab(
    "Assets/Avatars/Main.prefab",
    `--- !u!114 &2\nMonoBehaviour:\n${DESCRIPTOR}`,
    MAIN,
  );
  prefab(
    "Assets/Avatars/Main No Jacket.prefab",
    instance(0, MAIN),
    "b".repeat(32),
  );
  prefab(
    "Assets/Outfits/Stage.prefab",
    `--- !u!4 &3\nTransform:\n${instance(3, MAIN)}`,
    "c".repeat(32),
  );
  prefab(
    "Assets/Outfits/main.prefab",
    "--- !u!1 &4\nGameObject:\n",
    "d".repeat(32),
  );
  prefab("Assets/.hidden/Hidden.prefab", DESCRIPTOR);
  prefab("Assets/Samples~/Sample.prefab", DESCRIPTOR);
  return root;
}

test("a variant's base is its root prefab instance; nested instances do not count", () => {
  assert.equal(variantBaseGuid(instance(0, MAIN)), MAIN);
  assert.equal(
    variantBaseGuid(`--- !u!4 &3\nTransform:\n${instance(3, MAIN)}`),
    null,
  );
  assert.equal(variantBaseGuid("--- !u!1 &4\nGameObject:\n"), null);
});

test("finds Avatar prefabs and their variants, skipping folders Unity ignores", async () => {
  const root = project();
  try {
    assert.deepEqual(await findPrefabs(root), [
      {
        path: "Assets/Avatars/Main No Jacket.prefab",
        name: "Main No Jacket",
        avatar: true,
      },
      { path: "Assets/Avatars/Main.prefab", name: "Main", avatar: true },
      { path: "Assets/Outfits/Stage.prefab", name: "Stage", avatar: false },
      { path: "Assets/Outfits/main.prefab", name: "main", avatar: false },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolves a prefab by path, by name, or as the only Avatar", async () => {
  const root = project();
  try {
    const prefabs = await findPrefabs(root);
    const where = { project: root, cwd: root };
    assert.equal(
      resolvePrefab(prefabs, "Assets/Outfits/Stage.prefab", where),
      "Assets/Outfits/Stage.prefab",
    );
    assert.equal(
      resolvePrefab(prefabs, "main no jacket", where),
      "Assets/Avatars/Main No Jacket.prefab",
    );
    assert.equal(
      resolvePrefab(prefabs, "Stage.prefab", where),
      "Assets/Outfits/Stage.prefab",
    );
    assert.equal(
      resolvePrefab(prefabs.slice(1), undefined, where),
      "Assets/Avatars/Main.prefab",
    );
    assert.throws(
      () => resolvePrefab(prefabs, undefined, where),
      (error) => {
        assert.match(
          error.message,
          /Main No Jacket {2}\(Assets\/Avatars\/Main No Jacket\.prefab\)/,
        );
        assert.match(
          error.message,
          /npx animama-avatar-converter "Main No Jacket"/,
        );
        return true;
      },
    );
    assert.throws(
      () => resolvePrefab(prefabs, "Nobody", where),
      /No prefab named Nobody\.\nAvatar prefabs in this project:/,
    );
    assert.throws(
      () => resolvePrefab(prefabs, "Assets/Nope.prefab", where),
      /No prefab at Assets\/Nope\.prefab/,
    );
    assert.throws(
      () => resolvePrefab([], undefined, where),
      /No VRChat Avatar prefabs were found/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts ./, absolute, backslash and differently cased paths", async () => {
  const root = project();
  try {
    const prefabs = await findPrefabs(root);
    const stage = "Assets/Outfits/Stage.prefab";
    const outfits = {
      project: root,
      cwd: path.join(root, "Assets", "Outfits"),
    };
    assert.equal(
      resolvePrefab(prefabs, "./Assets/Outfits/Stage.prefab", {
        project: root,
        cwd: root,
      }),
      stage,
    );
    assert.equal(
      resolvePrefab(prefabs, path.join(root, stage), {
        project: root,
        cwd: "/elsewhere",
      }),
      stage,
    );
    assert.equal(
      resolvePrefab(prefabs, "Assets\\Outfits\\Stage.prefab", {
        project: root,
        cwd: root,
      }),
      stage,
    );
    assert.equal(
      resolvePrefab(prefabs, "assets/outfits/stage.prefab", {
        project: root,
        cwd: root,
      }),
      stage,
    );
    assert.equal(resolvePrefab(prefabs, "./Stage.prefab", outfits), stage);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an Avatar wins over other prefabs of its name; Avatars sharing a name need a path", async () => {
  const root = project();
  try {
    const prefabs = await findPrefabs(root);
    const where = { project: root, cwd: root };
    assert.equal(
      resolvePrefab(prefabs, "Main", where),
      "Assets/Avatars/Main.prefab",
    );
    const twins = [
      { path: "Assets/PC/Avatar.prefab", name: "Avatar", avatar: true },
      { path: "Assets/Quest/Avatar.prefab", name: "Avatar", avatar: true },
    ];
    assert.throws(
      () => resolvePrefab(twins, "Avatar", where),
      /Several prefabs are named Avatar[\s\S]*Assets\/Quest\/Avatar\.prefab/,
    );
    assert.throws(
      () => resolvePrefab(twins, undefined, where),
      /npx animama-avatar-converter Assets\/PC\/Avatar\.prefab/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
