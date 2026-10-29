using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace Animama.AvatarExport.Tests
{
    public class RequirementsTests
    {
        private static readonly Dictionary<string, InstalledPackage> Ready = new Dictionary<string, InstalledPackage>
        {
            ["com.vrmc.gltf"] = new InstalledPackage("0.131.2", null),
            ["com.vrmc.vrm"] = new InstalledPackage("0.131.2", null),
            ["org.mochiya.avatar-tools"] = new InstalledPackage("0.1.6", Requirements.MochiyaCommit),
            ["jp.lilxyzw.liltoon"] = new InstalledPackage("2.3.4", null),
        };

        [Test]
        public void AReadyProjectMeetsEveryRequirement()
        {
            var statuses = Requirements.Evaluate(Ready, "2022.3.62f3", null);

            Assert.That(statuses.Select(status => status.Component), Is.EqualTo(new[]
            {
                "Unity", "UniGLTF", "UniVRM 1.0", "Mochiya Avatar Tools", "lilToon",
            }));
            Assert.That(statuses.Where(status => !status.IsMet), Is.Empty);
            Assert.That(Requirements.UrlsToInstall(statuses), Is.Empty);
        }

        [Test]
        public void MissingDependenciesAreInstalledTogether()
        {
            var packages = new Dictionary<string, InstalledPackage>();

            var statuses = Requirements.Evaluate(packages, "2022.3.62f3", null);

            Assert.That(State(statuses, "UniGLTF"), Is.EqualTo(RequirementState.Missing));
            Assert.That(State(statuses, "Mochiya Avatar Tools"), Is.EqualTo(RequirementState.Missing));
            Assert.That(State(statuses, "lilToon"), Is.EqualTo(RequirementState.Met), "lilToon is needed only by Avatars that use it");
            Assert.That(Requirements.UrlsToInstall(statuses), Is.EqualTo(new[]
            {
                Requirements.UniGltfUrl, Requirements.Vrm10Url, Requirements.MochiyaUrl,
            }));
        }

        [Test]
        public void OtherDependencyVersionsAreReplaced()
        {
            var packages = new Dictionary<string, InstalledPackage>(Ready)
            {
                ["com.vrmc.vrm"] = new InstalledPackage("0.131.3", null),
                ["org.mochiya.avatar-tools"] = new InstalledPackage("0.1.6", "ad47df79aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            };

            var statuses = Requirements.Evaluate(packages, "2022.3.62f3", null);

            var vrm = statuses.Single(status => status.Component == "UniVRM 1.0");
            Assert.That(vrm.State, Is.EqualTo(RequirementState.Unsupported));
            Assert.That(vrm.Found, Is.EqualTo("0.131.3"));
            Assert.That(vrm.Required, Is.EqualTo("0.131.2"));
            Assert.That(State(statuses, "Mochiya Avatar Tools"), Is.EqualTo(RequirementState.Unsupported));
            Assert.That(Requirements.UrlsToInstall(statuses), Is.EqualTo(new[] { Requirements.Vrm10Url, Requirements.MochiyaUrl }));
        }

        [Test]
        public void MochiyaFromADownloadIsMatchedByVersion()
        {
            var packages = new Dictionary<string, InstalledPackage>(Ready)
            {
                ["org.mochiya.avatar-tools"] = new InstalledPackage(Requirements.MochiyaVersion, null),
            };

            Assert.That(State(Requirements.Evaluate(packages, "2022.3.62f3", null), "Mochiya Avatar Tools"), Is.EqualTo(RequirementState.Met));
        }

        [TestCase("2022.3.22f1", RequirementState.Met)]
        [TestCase("2021.3.45f1", RequirementState.Unsupported)]
        [TestCase("6000.0.40f1", RequirementState.Unsupported)]
        public void RequiresUnity2022_3(string unityVersion, RequirementState expected)
        {
            var statuses = Requirements.Evaluate(Ready, unityVersion, null);

            Assert.That(State(statuses, "Unity"), Is.EqualTo(expected));
            Assert.That(Requirements.UrlsToInstall(statuses), Is.Empty, "the Unity version cannot be installed from here");
        }

        [TestCase("2.3.4", RequirementState.Met)]
        [TestCase("2.10.0", RequirementState.Met)]
        [TestCase("1.4.0", RequirementState.Unsupported)]
        [TestCase("2.3.3", RequirementState.Unsupported)]
        [TestCase("3.0.0", RequirementState.Unsupported)]
        public void RequiresLilToon2_3_4OrLaterWithin2(string version, RequirementState expected)
        {
            var packages = new Dictionary<string, InstalledPackage>(Ready) { ["jp.lilxyzw.liltoon"] = new InstalledPackage(version, null) };

            var lilToon = Requirements.Evaluate(packages, "2022.3.62f3", null).Single(status => status.Component == "lilToon");

            Assert.That(lilToon.State, Is.EqualTo(expected));
            if (expected != RequirementState.Met) Assert.That(lilToon.Fix, Does.Contain("lilToon"));
        }

        [Test]
        public void ReadsLilToonCopiedIntoAssets()
        {
            var packages = new Dictionary<string, InstalledPackage>(Ready);
            packages.Remove("jp.lilxyzw.liltoon");

            var lilToon = Requirements.Evaluate(packages, "2022.3.62f3", "1.4.0").Single(status => status.Component == "lilToon");

            Assert.That(lilToon.State, Is.EqualTo(RequirementState.Unsupported));
            Assert.That(lilToon.Found, Is.EqualTo("1.4.0"));
        }

        [Test]
        public void EveryUnmetRequirementSaysHowToFixIt()
        {
            var statuses = Requirements.Evaluate(new Dictionary<string, InstalledPackage>
            {
                ["jp.lilxyzw.liltoon"] = new InstalledPackage("1.4.0", null),
            }, "2021.3.45f1", null);

            foreach (var status in statuses.Where(status => !status.IsMet))
            {
                Assert.That(status.Fix, Is.Not.Empty, status.Component);
                Assert.That(status.Describe(), Does.Contain(status.Component).And.Contain(status.Required));
            }
        }

        [Test]
        public void UpdatesAnInstalledUniVrm0WithUniGltf()
        {
            Assert.That(Requirements.Evaluate(Ready, "2022.3.62f3", null).Select(status => status.Component), Has.None.EqualTo("UniVRM 0.x"));

            var packages = new Dictionary<string, InstalledPackage>(Ready) { ["com.vrmc.univrm"] = new InstalledPackage("0.128.0", null) };
            var statuses = Requirements.Evaluate(packages, "2022.3.62f3", null);

            Assert.That(State(statuses, "UniVRM 0.x"), Is.EqualTo(RequirementState.Unsupported));
            Assert.That(Requirements.UrlsToInstall(statuses), Is.EqualTo(new[] { Requirements.Vrm0Url }));
        }

        [Test]
        public void TheInstallDialogSaysWhatChanges()
        {
            var packages = new Dictionary<string, InstalledPackage>(Ready) { ["com.vrmc.vrm"] = new InstalledPackage("0.131.3", null) };
            packages.Remove("org.mochiya.avatar-tools");

            var changes = RequirementsView.InstallChanges(Requirements.Evaluate(packages, "2022.3.62f3", null));

            Assert.That(changes, Is.EqualTo(new[]
            {
                "UniVRM 1.0: replace 0.131.3 with 0.131.2",
                "Mochiya Avatar Tools: install 0.1.6 (commit 0826f6e3)",
            }));
        }

        private static RequirementState State(IEnumerable<RequirementStatus> statuses, string component) =>
            statuses.Single(status => status.Component == component).State;
    }
}
