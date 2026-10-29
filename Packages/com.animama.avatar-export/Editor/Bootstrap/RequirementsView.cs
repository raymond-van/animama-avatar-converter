using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Animama.AvatarExport
{
    /// <summary>Draws the requirement checks and the Install dependencies button.</summary>
    internal sealed class RequirementsView
    {
        private IReadOnlyList<RequirementStatus> statuses = Requirements.Check();
        private string installMessage;
        private bool installing;

        public bool AllMet => statuses.All(status => status.IsMet);

        public void Refresh() => statuses = Requirements.Check();

        /// <summary>Draws the checks; shows only problems unless <paramref name="showMet"/>.</summary>
        public void Draw(bool showMet)
        {
            foreach (var status in statuses.Where(status => showMet || !status.IsMet))
                EditorGUILayout.HelpBox(status.Describe(), status.IsMet ? MessageType.None : MessageType.Error);

            var urls = Requirements.UrlsToInstall(statuses);
            if (urls.Count > 0)
            {
                using (new EditorGUI.DisabledScope(installing))
                {
                    if (GUILayout.Button(installing ? "Installing…" : "Install dependencies"))
                    {
                        Install(urls);
                        GUIUtility.ExitGUI(); // The dialogs break the current GUI layout.
                    }
                }
            }
            if (installMessage != null) EditorGUILayout.HelpBox(installMessage, MessageType.Warning);
        }

        /// <summary>What installing changes, one line per package: "install" or "replace … with …".</summary>
        internal static IEnumerable<string> InstallChanges(IEnumerable<RequirementStatus> statuses) =>
            statuses.Where(status => !status.IsMet && status.InstallUrl != null).Select(status =>
                status.State == RequirementState.Missing
                    ? $"{status.Component}: install {status.Required}"
                    : $"{status.Component}: replace {status.Found} with {status.Required}");

        private void Install(IReadOnlyList<string> urls)
        {
            if (!DependencyInstaller.GitAvailable())
            {
                installMessage = "Unity installs these packages with Git, which was not found. Install Git, restart Unity Hub and Unity, then try again.";
                if (EditorUtility.DisplayDialog("Git is required", installMessage, "Download Git", "Close"))
                    Application.OpenURL(DependencyInstaller.GitDownloadUrl);
                return;
            }
            if (!EditorUtility.DisplayDialog("Install dependencies",
                    "Change these packages in this project's Packages/manifest.json? Unity downloads them and recompiles.\n\n"
                    + string.Join("\n", InstallChanges(statuses)),
                    "Install", "Cancel"))
                return;
            installing = true;
            installMessage = null;
            DependencyInstaller.Install(urls, error =>
            {
                installing = false;
                installMessage = error == null ? null : "Installing failed: " + error;
                Refresh();
            });
        }
    }
}
