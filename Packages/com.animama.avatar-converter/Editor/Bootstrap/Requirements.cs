using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEngine;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;

namespace Animama.AvatarConverter
{
    public enum RequirementState
    {
        Met,
        Missing,
        Unsupported,
    }

    /// <summary>One component the export needs, as found in this project.</summary>
    public sealed class RequirementStatus
    {
        public RequirementStatus(string component, string found, string required, RequirementState state, string fix, string installUrl = null)
        {
            Component = component;
            Found = found;
            Required = required;
            State = state;
            Fix = fix;
            InstallUrl = installUrl;
        }

        public string Component { get; }

        /// <summary>The installed version, or "not installed".</summary>
        public string Found { get; }

        public string Required { get; }

        public RequirementState State { get; }

        /// <summary>What the user should do when the requirement is not met.</summary>
        public string Fix { get; }

        /// <summary>The Git URL that installs the supported version, when the package installs it.</summary>
        public string InstallUrl { get; }

        public bool IsMet => State == RequirementState.Met;

        public string Describe() =>
            IsMet
                ? $"{Component} {Found}"
                : $"{Component}: found {Found}, requires {Required}. {Fix}";
    }

    /// <summary>A package as Unity's Package Manager registers it.</summary>
    internal readonly struct InstalledPackage
    {
        public InstalledPackage(string version, string gitHash)
        {
            Version = version;
            GitHash = gitHash;
        }

        public string Version { get; }

        /// <summary>The commit of a package installed from a Git URL, otherwise null.</summary>
        public string GitHash { get; }
    }

    /// <summary>
    /// The editor and package versions the export supports (Unity 2022.3,
    /// UniGLTF and UniVRM 1.0 0.131.2, Mochiya Avatar Tools at a tested commit,
    /// lilToon 2.3.4 or later within 2.x), checked against this project.
    /// </summary>
    public static class Requirements
    {
        public const string UniVrmVersion = "0.131.2";
        public const string UniGltfUrl = "https://github.com/vrm-c/UniVRM.git?path=/Packages/UniGLTF#v0.131.2";
        public const string Vrm10Url = "https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM10#v0.131.2";
        public const string Vrm0Url = "https://github.com/vrm-c/UniVRM.git?path=/Packages/VRM#v0.131.2";

        /// <summary>The tested Mochiya commit; its repository has no tags.</summary>
        public const string MochiyaCommit = "0826f6e3e453ac1885d6594b831181655c4a1b5c";

        public const string MochiyaVersion = "0.1.6";
        public const string MochiyaUrl = "https://github.com/mochiya-labs/unity-avatar-tools.git#" + MochiyaCommit;

        private const string UnityLine = "2022.3";
        private const string NotInstalled = "not installed";
        private static readonly Version LilToonMinimum = new Version(2, 3, 4);

        /// <summary>Checks this project.</summary>
        public static IReadOnlyList<RequirementStatus> Check() =>
            Evaluate(InstalledPackages(), Application.unityVersion, LilToonVersionInAssets());

        /// <summary>The Git URLs that install every unmet dependency the package can install.</summary>
        public static IReadOnlyList<string> UrlsToInstall(IEnumerable<RequirementStatus> statuses) =>
            statuses.Where(status => !status.IsMet && status.InstallUrl != null).Select(status => status.InstallUrl).ToList();

        internal static IReadOnlyList<RequirementStatus> Evaluate(
            IReadOnlyDictionary<string, InstalledPackage> packages,
            string unityVersion,
            string lilToonInAssets)
        {
            var statuses = new List<RequirementStatus>
            {
                new RequirementStatus("Unity", unityVersion, UnityLine,
                    unityVersion.StartsWith(UnityLine + ".") ? RequirementState.Met : RequirementState.Unsupported,
                    "Open the project in Unity 2022.3, the editor VRChat uses."),
                ExactVersion(packages, "com.vrmc.gltf", "UniGLTF", UniGltfUrl),
                ExactVersion(packages, "com.vrmc.vrm", "UniVRM 1.0", Vrm10Url),
                Mochiya(packages),
                LilToon(packages.TryGetValue("jp.lilxyzw.liltoon", out var lilToon) ? lilToon.Version : lilToonInAssets),
            };
            // UniVRM for VRM 0.x is optional, but it must match UniGLTF's version, so it is updated with it.
            if (packages.ContainsKey("com.vrmc.univrm"))
                statuses.Insert(3, ExactVersion(packages, "com.vrmc.univrm", "UniVRM 0.x", Vrm0Url));
            return statuses;
        }

        private static RequirementStatus ExactVersion(
            IReadOnlyDictionary<string, InstalledPackage> packages, string name, string component, string url)
        {
            if (!packages.TryGetValue(name, out var package))
                return new RequirementStatus(component, NotInstalled, UniVrmVersion, RequirementState.Missing,
                    "Choose Install dependencies.", url);
            return package.Version == UniVrmVersion
                ? new RequirementStatus(component, package.Version, UniVrmVersion, RequirementState.Met, "", url)
                : new RequirementStatus(component, package.Version, UniVrmVersion, RequirementState.Unsupported,
                    "Choose Install dependencies to switch to the supported version.", url);
        }

        private static RequirementStatus Mochiya(IReadOnlyDictionary<string, InstalledPackage> packages)
        {
            const string component = "Mochiya Avatar Tools";
            var required = $"{MochiyaVersion} (commit {MochiyaCommit.Substring(0, 8)})";
            if (!packages.TryGetValue("org.mochiya.avatar-tools", out var package))
                return new RequirementStatus(component, NotInstalled, required, RequirementState.Missing,
                    "Choose Install dependencies.", MochiyaUrl);
            var found = package.GitHash != null ? $"{package.Version} (commit {package.GitHash.Substring(0, Math.Min(8, package.GitHash.Length))})" : package.Version;
            // A Git install is matched by commit; a downloaded copy has only its version.
            var tested = package.GitHash != null ? package.GitHash == MochiyaCommit : package.Version == MochiyaVersion;
            return tested
                ? new RequirementStatus(component, found, required, RequirementState.Met, "", MochiyaUrl)
                : new RequirementStatus(component, found, required, RequirementState.Unsupported,
                    "Choose Install dependencies to switch to the tested version.", MochiyaUrl);
        }

        /// <summary>lilToon is needed only by Avatars that use it, so a project without it passes.</summary>
        private static RequirementStatus LilToon(string version)
        {
            const string required = "2.3.4 or later within 2.x, when the Avatar uses lilToon";
            if (version == null)
                return new RequirementStatus("lilToon", "not installed (only Avatars that use lilToon need it)", required, RequirementState.Met, "");
            var supported = Version.TryParse(version, out var parsed) && parsed >= LilToonMinimum && parsed.Major == 2;
            return new RequirementStatus("lilToon", version, required,
                supported ? RequirementState.Met : RequirementState.Unsupported,
                "Replace lilToon with a 2.x release, 2.3.4 or later, from the lilToon VPM repository (https://lilxyzw.github.io/vpm-repos/vpm.json), "
                + "deleting an Assets/lilToon copy first; compare the Avatar with screenshots taken before, since its look can change.");
        }

        private static IReadOnlyDictionary<string, InstalledPackage> InstalledPackages() =>
            PackageInfo.GetAllRegisteredPackages().ToDictionary(
                package => package.name,
                package => new InstalledPackage(package.version, string.IsNullOrEmpty(package.git?.hash) ? null : package.git.hash));

        /// <summary>The version of a lilToon copied into Assets by an Avatar's own unitypackage, if any.</summary>
        private static string LilToonVersionInAssets()
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                var constants = assembly.GetType("lilToon.lilConstants", false);
                var field = constants?.GetField("currentVersionName", BindingFlags.Public | BindingFlags.Static);
                if (field?.GetValue(null) is string version) return version;
            }
            return null;
        }
    }
}
