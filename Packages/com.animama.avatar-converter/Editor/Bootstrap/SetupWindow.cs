using UnityEditor;
using UnityEngine;

namespace Animama.AvatarConverter
{
    /// <summary>
    /// Shows what the export needs and installs the missing dependencies on
    /// request. Opens once per editor session when the export cannot compile yet.
    /// </summary>
    [InitializeOnLoad]
    internal sealed class SetupWindow : EditorWindow
    {
        private const string PromptedKey = "Animama.AvatarConverter.SetupPrompted";
        private RequirementsView requirements;

        static SetupWindow()
        {
            // After every assembly has loaded, so the export code has registered if it compiled.
            EditorApplication.delayCall += () =>
            {
                if (Application.isBatchMode || ExportMenu.OpenExportWindow != null || SessionState.GetBool(PromptedKey, false)) return;
                SessionState.SetBool(PromptedKey, true);
                if (!new RequirementsView().AllMet) Open();
            };
        }

        public static void Open() => GetWindow<SetupWindow>(true, "Animama Avatar Converter Setup").Show();

        private void OnEnable() => requirements = new RequirementsView();

        private void OnFocus() => requirements?.Refresh();

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Animama Avatar Converter", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(
                "Exports a VRChat Avatar you own to a VRM file for Animama, through Mochiya Avatar Tools and UniVRM. Nothing is uploaded.",
                EditorStyles.wordWrappedLabel);
            EditorGUILayout.Space();
            requirements.Draw(showMet: true);
            EditorGUILayout.Space();
            if (requirements.AllMet && ExportMenu.OpenExportWindow != null && GUILayout.Button("Open Export for Animama"))
            {
                ExportMenu.OpenExportWindow();
                Close();
            }
            else if (requirements.AllMet && ExportMenu.OpenExportWindow == null)
                EditorGUILayout.HelpBox("Waiting for Unity to compile the export code.", MessageType.Info);
        }
    }
}
