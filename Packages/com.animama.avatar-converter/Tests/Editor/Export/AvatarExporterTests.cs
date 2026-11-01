using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Animama.AvatarConverter.Tests
{
    /// <summary>
    /// Export behavior around the converter: the source prefab and the user's
    /// scenes stay untouched, outputs are never overwritten or left half
    /// written. A fake converter stands in for Mochiya.
    /// </summary>
    public class AvatarExporterTests
    {
        private const string AssetFolder = "Assets/AnimamaExportTests";
        private string outputFolder;

        [SetUp]
        public void SetUp()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            if (!AssetDatabase.IsValidFolder(AssetFolder)) AssetDatabase.CreateFolder("Assets", "AnimamaExportTests");
            outputFolder = Path.Combine(Path.GetTempPath(), "animama-export-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(outputFolder);
        }

        [TearDown]
        public void TearDown()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(AssetFolder);
            Directory.Delete(outputFolder, true);
        }

        [Test]
        public void StripsOnlyTheTopmostEditorOnlyObjects()
        {
            var root = new GameObject("Root");
            var jacket = Child(root, "Jacket", editorOnly: true);
            Child(jacket, "Sleeve", editorOnly: true);
            var body = Child(root, "Body");
            Child(body, "Marker", editorOnly: true);
            Child(root, "Hair");
            var log = new List<string>();

            AvatarExporter.StripEditorOnly(root, log.Add);

            Assert.That(Names(root), Is.EquivalentTo(new[] { "Root", "Body", "Hair" }));
            Assert.That(log, Is.EquivalentTo(new[]
            {
                "Stripped EditorOnly object Jacket",
                "Stripped EditorOnly object Marker",
            }));
            UnityEngine.Object.DestroyImmediate(root);
        }

        [Test]
        public void StripsEditorOnlyObjectsInsideAPrefabInstance()
        {
            var source = new GameObject("Avatar");
            Child(source, "Jacket", editorOnly: true);
            var prefab = SavePrefab(source);
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);

            AvatarExporter.StripEditorOnly(instance, _ => { });

            Assert.That(Names(instance), Is.EquivalentTo(new[] { "Avatar" }));
            Assert.That(Names(prefab), Is.EquivalentTo(new[] { "Avatar", "Jacket" }), "the prefab asset keeps its objects");
            UnityEngine.Object.DestroyImmediate(instance);
        }

        [Test]
        public void ExportsThroughATemporaryFileAndRestoresTheOpenScene()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var scenePath = SaveSceneWithMarker();
            var converter = new FakeConverter();
            var target = Path.Combine(outputFolder, "Avatar.vrm");

            var result = AvatarExporter.Run(prefab, target, KeepPose(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Exported), result.Error);
            Assert.That(File.ReadAllBytes(target), Is.EqualTo(FakeConverter.Bytes));
            Assert.That(result.Bytes, Is.EqualTo(FakeConverter.Bytes.Length));
            Assert.That(converter.ExportedTo, Is.Not.EqualTo(target));
            Assert.That(Path.GetDirectoryName(converter.ExportedTo), Is.EqualTo(outputFolder));
            Assert.That(converter.ExportedTo, Does.EndWith(".vrm"));
            Assert.That(Directory.GetFiles(outputFolder), Is.EquivalentTo(new[] { target }));
            Assert.That(converter.RootScenePath, Is.Not.EqualTo(scenePath), "the export ran outside the user's scene");
            Assert.That(converter.Disposed, Is.True);
            AssertSceneRestored(scenePath);
            Assert.That(result.Log, Has.Some.StartsWith("Detect: "));
            Assert.That(result.Log, Has.Some.StartsWith("Validate:\n"));
            Assert.That(result.Log.Last(), Does.StartWith("Wrote " + target));
        }

        [Test]
        public void ValidatesWithoutWritingAFile()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var scenePath = SaveSceneWithMarker();
            var converter = new FakeConverter();

            var result = AvatarExporter.Run(prefab, null, KeepPose(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Validated), result.Error);
            Assert.That(converter.ExportedTo, Is.Null);
            AssertSceneRestored(scenePath);
        }

        [Test]
        public void ReportsAnAvatarTheConverterCannotConvert()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var scenePath = SaveSceneWithMarker();
            var converter = new FakeConverter { CanConvert = false };
            var target = Path.Combine(outputFolder, "Avatar.vrm");

            var result = AvatarExporter.Run(prefab, target, KeepPose(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.CannotConvert));
            Assert.That(converter.ExportedTo, Is.Null);
            Assert.That(Directory.GetFiles(outputFolder), Is.Empty);
            AssertSceneRestored(scenePath);
        }

        [Test]
        public void ReportsEachLineAsItHappens()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var lines = new List<string>();
            var converter = new FakeConverter();
            converter.OnExport = () => converter.LinesBeforeExport = lines.Count;

            var result = AvatarExporter.Run(prefab, Path.Combine(outputFolder, "Avatar.vrm"), KeepPose(), (_, __) => converter, lines.Add);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Exported), result.Error);
            Assert.That(lines, Is.EqualTo(result.Log));
            Assert.That(converter.LinesBeforeExport, Is.GreaterThanOrEqualTo(3), "pose, Detect and Validate lines arrive before the export");
        }

        [Test]
        public void ReopensTheSavedScenesWithALoadedOneActive()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var unloadedPath = SaveSceneWithMarker();
            var loadedPath = SaveSceneWithMarker();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var unloaded = EditorSceneManager.OpenScene(unloadedPath, OpenSceneMode.Additive);
            EditorSceneManager.OpenScene(loadedPath, OpenSceneMode.Additive);
            EditorSceneManager.CloseScene(unloaded, false);

            var result = AvatarExporter.Run(prefab, null, KeepPose(), (_, __) => new FakeConverter());

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Validated), result.Error);
            Assert.That(result.Log, Has.None.StartsWith("Could not reopen"));
            Assert.That(SceneManager.GetActiveScene().path, Is.EqualTo(loadedPath));
            var reopened = Enumerable.Range(0, SceneManager.sceneCount).Select(SceneManager.GetSceneAt).ToList();
            Assert.That(reopened.Select(scene => scene.path), Is.EqualTo(new[] { unloadedPath, loadedPath }));
            Assert.That(reopened.Select(scene => scene.isLoaded), Is.EqualTo(new[] { false, true }));
        }

        [Test]
        public void ReopensALoneUnloadedSceneLoaded()
        {
            // Unity's own scene setup reports a lone saved scene as loaded and
            // active when only an untitled scene is loaded beside it.
            var prefab = SavePrefab(new GameObject("Avatar"));
            var unloadedPath = SaveSceneWithMarker();
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            EditorSceneManager.CloseScene(EditorSceneManager.OpenScene(unloadedPath, OpenSceneMode.Additive), false);

            var result = AvatarExporter.Run(prefab, null, KeepPose(), (_, __) => new FakeConverter());

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Validated), result.Error);
            Assert.That(result.Log, Has.None.StartsWith("Could not reopen"));
            Assert.That(SceneManager.GetActiveScene().path, Is.EqualTo(unloadedPath));
        }

        [Test]
        public void ChoosesALoadedSavedSceneToBeActive()
        {
            var setup = new[]
            {
                Setup("Assets/A.unity", loaded: false, active: false),
                Setup("", loaded: true, active: true),
                Setup("Assets/B.unity", loaded: true, active: false),
            };

            var reopened = SceneSetupScope.ScenesToReopen(setup);

            Assert.That(reopened.Select(scene => scene.path), Is.EqualTo(new[] { "Assets/A.unity", "Assets/B.unity" }));
            Assert.That(reopened.Select(scene => scene.isActive), Is.EqualTo(new[] { false, true }));
        }

        [Test]
        public void ReopensNothingWhenNoSavedSceneIsLoaded()
        {
            var setup = new[] { Setup("", loaded: true, active: true), Setup("Assets/A.unity", loaded: false, active: false) };

            Assert.That(SceneSetupScope.ScenesToReopen(setup), Is.Empty);
        }

        [Test]
        public void RequiresAVrmOutputFile()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var converter = new FakeConverter();

            var result = AvatarExporter.Run(prefab, Path.Combine(outputFolder, "Avatar.glb"), KeepPose(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Failed));
            Assert.That(result.Error, Does.Contain(".vrm"));
            Assert.That(converter.Validated, Is.False);
        }

        [Test]
        public void NeverOverwritesAnExistingFile()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var converter = new FakeConverter();
            var target = Path.Combine(outputFolder, "Avatar.vrm");
            File.WriteAllText(target, "keep me");

            var result = AvatarExporter.Run(prefab, target, KeepPose(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Failed));
            Assert.That(result.Error, Does.Contain("exists"));
            Assert.That(File.ReadAllText(target), Is.EqualTo("keep me"));
            Assert.That(converter.ExportedTo, Is.Null);
        }

        [Test]
        public void AFailedExportLeavesNoFiles()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var scenePath = SaveSceneWithMarker();
            var converter = new FakeConverter { FailAfterWriting = true };
            var target = Path.Combine(outputFolder, "Avatar.vrm");

            var result = AvatarExporter.Run(prefab, target, KeepPose(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Failed));
            Assert.That(result.Error, Does.Contain("converter failed"));
            Assert.That(converter.ExportedTo, Is.Not.Null);
            Assert.That(Directory.GetFiles(outputFolder), Is.Empty);
            AssertSceneRestored(scenePath);
        }

        [Test]
        public void RequiresAHumanoidForTheTPose()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var converter = new FakeConverter();

            var result = AvatarExporter.Run(prefab, null, new ExportOptions(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Failed));
            Assert.That(result.Error, Does.Contain("humanoid").And.Contain("keep-pose option"));
            Assert.That(converter.Validated, Is.False);
        }

        [Test]
        public void RefusesWhileAnOpenSceneHasUnsavedChanges()
        {
            var prefab = SavePrefab(new GameObject("Avatar"));
            var scenePath = SaveSceneWithMarker();
            new GameObject("Unsaved");
            EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
            var converter = new FakeConverter();

            var result = AvatarExporter.Run(prefab, null, KeepPose(), (_, __) => converter);

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Failed));
            Assert.That(result.Error, Does.Contain("Save"));
            Assert.That(SceneManager.GetActiveScene().path, Is.EqualTo(scenePath));
            Assert.That(SceneManager.GetActiveScene().isDirty, Is.True);
            Assert.That(GameObject.Find("Unsaved"), Is.Not.Null);
            Assert.That(converter.Validated, Is.False);
        }

        [Test]
        public void RequiresAPrefabAsset()
        {
            var sceneObject = new GameObject("Avatar");

            var result = AvatarExporter.Run(sceneObject, null, KeepPose(), (_, __) => new FakeConverter());

            Assert.That(result.Status, Is.EqualTo(ExportStatus.Failed));
            Assert.That(result.Error, Does.Contain("prefab"));
            UnityEngine.Object.DestroyImmediate(sceneObject);
        }

        private static ExportOptions KeepPose() => new ExportOptions { KeepPose = true };

        private static SceneSetup Setup(string path, bool loaded, bool active) =>
            new SceneSetup { path = path, isLoaded = loaded, isActive = active };

        private static GameObject Child(GameObject parent, string name, bool editorOnly = false)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent.transform, false);
            if (editorOnly) child.tag = "EditorOnly";
            return child;
        }

        private static IEnumerable<string> Names(GameObject root) =>
            root.GetComponentsInChildren<Transform>(true).Select(transform => transform.name);

        /// <summary>
        /// Saves a prefab asset from a scene object, then opens a clean untitled
        /// scene: building the source dirtied the previous one. Call it before
        /// opening a test's working scene.
        /// </summary>
        private static GameObject SavePrefab(GameObject source)
        {
            var path = AssetDatabase.GenerateUniqueAssetPath(AssetFolder + "/" + source.name + ".prefab");
            var prefab = PrefabUtility.SaveAsPrefabAsset(source, path);
            UnityEngine.Object.DestroyImmediate(source);
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            return prefab;
        }

        /// <summary>
        /// Opens a saved scene holding one marker object, as a user's working
        /// scene, and returns its path: a Scene handle is invalid once reopened.
        /// </summary>
        private static string SaveSceneWithMarker()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("Marker");
            var path = AssetDatabase.GenerateUniqueAssetPath(AssetFolder + "/Working.unity");
            EditorSceneManager.SaveScene(scene, path);
            return path;
        }

        private static void AssertSceneRestored(string scenePath)
        {
            var active = SceneManager.GetActiveScene();
            Assert.That(active.path, Is.EqualTo(scenePath));
            Assert.That(active.isDirty, Is.False);
            Assert.That(active.GetRootGameObjects().Select(root => root.name), Is.EqualTo(new[] { "Marker" }));
        }

        private sealed class FakeConverter : IAvatarConverter
        {
            public static readonly byte[] Bytes = { 1, 2, 3, 4 };
            public bool CanConvert = true;
            public bool FailAfterWriting;
            public bool Validated;
            public bool Disposed;
            public string ExportedTo;
            public string RootScenePath;
            public Action OnExport;
            public int LinesBeforeExport;

            public string Detect(GameObject root)
            {
                RootScenePath = root.scene.path;
                return "kind=Avatar";
            }

            public bool Validate(GameObject root, out string report)
            {
                Validated = true;
                report = CanConvert ? "Ready" : "Error: not convertible";
                return CanConvert;
            }

            public string Export(GameObject root, string path)
            {
                ExportedTo = path;
                OnExport?.Invoke();
                File.WriteAllBytes(path, Bytes);
                if (FailAfterWriting) throw new InvalidOperationException("The converter failed.");
                return "Exported";
            }

            public void Dispose() => Disposed = true;
        }
    }
}
