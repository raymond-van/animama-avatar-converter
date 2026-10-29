using System;
using System.IO;
using UnityEngine;

namespace Animama.AvatarExport
{
    /// <summary>
    /// The notice shown before the first export in a project, acknowledged once
    /// per user and project in UserSettings (which projects do not version).
    /// </summary>
    internal static class LicenceNotice
    {
        public const string Title = "Convert only an Avatar you may convert";

        public const string Text =
            "Export only an Avatar whose licence allows you to convert it for your own use. "
            + "Many Avatar licences, such as VN3, forbid sharing the Avatar or edited versions of it.\n\n"
            + "The export writes only the VRM file you choose on this computer and uploads nothing.\n\n"
            + "Do not share the exported file unless the Avatar's licence allows it.";

        public static string DefaultSettingsPath =>
            Path.Combine(Directory.GetParent(Application.dataPath).FullName, "UserSettings", "AnimamaAvatarExport.json");

        public static bool IsAcknowledged(string settingsPath)
        {
            try
            {
                return File.Exists(settingsPath) && JsonUtility.FromJson<Settings>(File.ReadAllText(settingsPath)).licenceAcknowledged;
            }
            catch (ArgumentException)
            {
                return false; // Unreadable settings ask again.
            }
        }

        public static void Acknowledge(string settingsPath)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(settingsPath));
            File.WriteAllText(settingsPath, JsonUtility.ToJson(new Settings { licenceAcknowledged = true }, true));
        }

        [Serializable]
        private sealed class Settings
        {
            public bool licenceAcknowledged;
        }
    }
}
