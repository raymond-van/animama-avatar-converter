using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Animama.AvatarConverter.Tests
{
    /// <summary>The window's decisions, separate from its drawing.</summary>
    public class ExportWindowLogicTests
    {
        private const string AssetFolder = "Assets/AnimamaExportWindowTests";
        private string tempFolder;

        [SetUp]
        public void SetUp()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            if (!AssetDatabase.IsValidFolder(AssetFolder)) AssetDatabase.CreateFolder("Assets", "AnimamaExportWindowTests");
            tempFolder = Path.Combine(Path.GetTempPath(), "animama-window-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempFolder);
        }

        [TearDown]
        public void TearDown()
        {
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            AssetDatabase.DeleteAsset(AssetFolder);
            Directory.Delete(tempFolder, true);
        }

        [Test]
        public void AcceptsAPrefabRoot()
        {
            var prefab = SavePrefab("Avatar");

            Assert.That(AvatarSource.Resolve(prefab, out var problem), Is.SameAs(prefab));
            Assert.That(problem, Is.Null);
        }

        [Test]
        public void RejectsAnObjectInsideAPrefab()
        {
            var prefab = SavePrefab("Avatar", withChild: true);

            Assert.That(AvatarSource.Resolve(prefab.transform.GetChild(0).gameObject, out var problem), Is.Null);
            Assert.That(problem, Does.Contain("root"));
        }

        [Test]
        public void UsesTheSourcePrefabOfAnUnchangedSceneInstance()
        {
            var prefab = SavePrefab("Avatar");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);

            Assert.That(AvatarSource.Resolve(instance, out var problem), Is.SameAs(prefab));
            Assert.That(problem, Is.Null);
        }

        [Test]
        public void RejectsASceneInstanceWithChangesButNotAMovedOne()
        {
            var prefab = SavePrefab("Avatar");
            var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            instance.transform.position = Vector3.one;
            PrefabUtility.RecordPrefabInstancePropertyModifications(instance.transform);
            Assert.That(AvatarSource.Resolve(instance, out _), Is.SameAs(prefab), "where the Avatar stands does not matter");

            new GameObject("Extra").transform.SetParent(instance.transform);

            Assert.That(AvatarSource.Resolve(instance, out var problem), Is.Null);
            Assert.That(problem, Does.Contain("changes"));
        }

        [Test]
        public void RejectsASceneObjectThatIsNotAPrefab()
        {
            var sceneObject = new GameObject("Avatar");

            Assert.That(AvatarSource.Resolve(sceneObject, out var problem), Is.Null);
            Assert.That(problem, Does.Contain("prefab"));
        }

        [Test]
        public void FindsModularAvatarComponents()
        {
            var avatar = new GameObject("Avatar");
            new GameObject("Outfit", typeof(Animator)).transform.SetParent(avatar.transform);
            Assert.That(ModularAvatar.FindComponent(avatar), Is.Null);

            // Components from editor assemblies cannot be added to objects, so the types are checked directly.
            var types = new[] { typeof(Animator), typeof(nadena.dev.modular_avatar.core.ModularAvatarMergeArmature) };

            Assert.That(ModularAvatar.FirstModularAvatarType(types), Is.EqualTo("ModularAvatarMergeArmature"));
        }

        [Test]
        public void RemembersTheLicenceAcknowledgement()
        {
            var settings = Path.Combine(tempFolder, "UserSettings", "AnimamaAvatarConverter.json");
            Assert.That(LicenceNotice.IsAcknowledged(settings), Is.False);

            LicenceNotice.Acknowledge(settings);

            Assert.That(LicenceNotice.IsAcknowledged(settings), Is.True);
        }

        [Test]
        public void TheLicenceNoticeCoversOwnUseAndSharingAndNeverMentionsUploading()
        {
            Assert.That(LicenceNotice.Text, Does.Contain("licence").And.Contain("this computer").And.Contain("uploads nothing").And.Contain("share"));
            Assert.That(LicenceNotice.Text, Does.Not.Contain("Mochiya"));
            Assert.That(LicenceNotice.Text.ToLowerInvariant(), Does.Not.Contain("upload to"));
        }

        [Test]
        public void ExplainsAValidationReportInPlainLanguage()
        {
            // Mochiya 0.1.6's validation lines for a VRChat Avatar.
            var report = string.Join("\n",
                "Unsupported: Body: custom VRChat Animator state machines are not executed by VRM. Their clips must be authored as VRM expressions or Mochiya actions.",
                "Unsupported: Collider_Head: VRCContactReceiver has no portable adapter.",
                "Warning: VRChat visemes, eyelid blendshapes and eye ranges are translated to VRM expressions/look-at where configured.",
                "Warning: HairRoot: PhysBone motion is approximated with VRM springs. Grabbing, stretching, limits and parameter output have no equivalent in this profile.",
                "Warning: SkirtRoot: PhysBone motion is approximated with VRM springs. Grabbing, stretching, limits and parameter output have no equivalent in this profile.");

            var items = ReportExplanations.Explain(report);

            Assert.That(items.Select(item => item.IsError), Has.All.False);
            Assert.That(items[0].Text, Does.Contain("not converted").And.Contain("Animama"));
            Assert.That(items[1].Text, Is.EqualTo("Collider_Head: VRCContactReceiver has no portable adapter."), "an object name is not a phrase");
            Assert.That(items[2].Text, Does.Contain("blinking").And.Contain("where the Avatar sets them up"));
            Assert.That(items[3].Text, Does.Contain("springs"));
            Assert.That(items[3].Count, Is.EqualTo(2));
        }

        [Test]
        public void ExplainsWhatOnlyTheExportFinds()
        {
            // Lines Mochiya adds while converting, after the validation lines.
            var report = string.Join("\n",
                "Warning: Only blendshape visemes are converted. Jaw-bone/parameter lip sync needs VRM expression authoring.",
                "Warning: Hips: Plane collider has no core VRM sphere/capsule representation and was omitted.",
                "Warning: SkirtRoot: inside-bounds collision is approximated as an outside collider and may push hair or clothing outward.",
                "Warning: Bag: collider outside the reference avatar was omitted.",
                "Warning: HairRoot: Gravity Falloff is baked into the rest-pose gravity strength; VRM does not reproduce its angle-dependent response.",
                "Warning: TailRoot: Gravity Falloff is baked into the rest-pose gravity strength; VRM does not reproduce its angle-dependent response.");

            var items = ReportExplanations.Explain(report);

            Assert.That(items[0].Text, Does.Contain("mouth may not move"));
            Assert.That(items[1].Text, Does.Contain("planes, are left out"));
            Assert.That(items[2].Text, Does.Contain("outside"));
            Assert.That(items[3].Text, Is.EqualTo("Bag: collider outside the reference avatar was omitted."));
            Assert.That(items[4].Text, Does.Contain("gravity falloff"));
            Assert.That(items[4].Count, Is.EqualTo(2));
        }

        [Test]
        public void ExplainsTheErrorsOfAPrefabThatIsNotAnAvatar()
        {
            var report = string.Join("\n",
                "Error: VRM conversion requires a valid Humanoid Animator with all required bones in its hierarchy. Use the lilToon GLB exporter for ordinary props.",
                "Error: This asset has no valid VRM humanoid. Place it directly under a valid independent avatar to convert it as an attachment.",
                "Error: The hierarchy contains a missing script. Remove or restore it first.");

            var items = ReportExplanations.Explain(report);

            Assert.That(items.Select(item => item.IsError), Has.All.True);
            Assert.That(items[0].Text, Does.Contain("humanoid rig"));
            Assert.That(items[1].Text, Does.Contain("outfit or accessory"));
            Assert.That(items[2].Text, Is.EqualTo("The hierarchy contains a missing script. Remove or restore it first."));
        }

        [Test]
        public void ListsWhatStopsAnExport()
        {
            var existing = Path.Combine(tempFolder, "Avatar.vrm");
            File.WriteAllText(existing, "");

            Assert.That(ExportBlockers.Find(true, false, null, null, Path.Combine(tempFolder, "New.vrm"), export: true), Is.Empty);
            Assert.That(ExportBlockers.Find(true, false, null, null, null, export: false), Is.Empty, "validation needs no output file");
            Assert.That(ExportBlockers.Find(false, false, null, null, null, export: false).Single(), Does.Contain("requirements"));
            Assert.That(ExportBlockers.Find(true, true, null, null, null, export: false).Single(), Does.Contain("Play Mode"));
            Assert.That(ExportBlockers.Find(true, false, "Choose the Avatar's prefab.", null, null, export: false).Single(), Is.EqualTo("Choose the Avatar's prefab."));
            Assert.That(ExportBlockers.Find(true, false, null, "ModularAvatarMergeArmature", null, export: false).Single(), Does.Contain("Modular Avatar"));
            Assert.That(ExportBlockers.Find(true, false, null, null, null, export: true).Single(), Does.Contain("where to save"));
            Assert.That(ExportBlockers.Find(true, false, null, null, existing, export: true).Single(), Does.Contain("already exists"));
        }

        private static GameObject SavePrefab(string name, bool withChild = false)
        {
            var source = new GameObject(name);
            if (withChild) new GameObject("Child").transform.SetParent(source.transform);
            var prefab = PrefabUtility.SaveAsPrefabAsset(source, AssetDatabase.GenerateUniqueAssetPath(AssetFolder + "/" + name + ".prefab"));
            UnityEngine.Object.DestroyImmediate(source);
            return prefab;
        }
    }
}

namespace nadena.dev.modular_avatar.core
{
    /// <summary>Stands in for a Modular Avatar component type; only its namespace matters.</summary>
    internal sealed class ModularAvatarMergeArmature
    {
    }
}
