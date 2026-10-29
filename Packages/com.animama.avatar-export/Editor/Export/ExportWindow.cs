using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Animama.AvatarExport
{
    /// <summary>
    /// Animama > Export for Animama…: pick an Avatar prefab, fill in the VRM
    /// details, validate and export. Shows Mochiya's report in plain language.
    /// </summary>
    internal sealed class ExportWindow : EditorWindow
    {
        private const string LastFolderKey = "Animama.AvatarExport.LastFolder";
        private const string DefaultVersion = "1.0";

        [SerializeField] private GameObject picked;
        [SerializeField] private string avatarName = "";
        [SerializeField] private string version = DefaultVersion;
        [SerializeField] private string author = "";
        [SerializeField] private string copyright = "";
        [SerializeField] private bool keepPose;
        [SerializeField] private string outputPath = "";

        private RequirementsView requirements;
        private ExportResult result;
        private IReadOnlyList<ReportItem> reportItems = Array.Empty<ReportItem>();
        private bool showLog;
        private Vector2 scroll;

        // The pick's resolution, refreshed when the pick, the hierarchy or the project changes.
        private GameObject prefab;
        private string sourceProblem;
        private string modularAvatar;

        [InitializeOnLoadMethod]
        private static void Register() => ExportMenu.OpenExportWindow = Open;

        public static void Open() => GetWindow<ExportWindow>("Export for Animama").Show();

        private void OnEnable()
        {
            requirements = new RequirementsView();
            ResolvePick();
        }

        private void OnFocus()
        {
            requirements?.Refresh();
            ResolvePick();
        }

        private void OnHierarchyChange() => ResolvePick();

        private void OnProjectChange() => ResolvePick();

        private void ResolvePick()
        {
            prefab = AvatarSource.Resolve(picked, out sourceProblem);
            modularAvatar = prefab != null ? ModularAvatar.FindComponent(prefab) : null;
        }

        private void OnGUI()
        {
            scroll = EditorGUILayout.BeginScrollView(scroll);
            EditorGUILayout.LabelField(
                "Exports a VRChat Avatar prefab to a VRM file on this computer, ready to add to Animama. The export itself uploads nothing.",
                EditorStyles.wordWrappedLabel);
            EditorGUILayout.Space();

            if (!requirements.AllMet)
            {
                EditorGUILayout.LabelField("Requirements", EditorStyles.boldLabel);
                requirements.Draw(showMet: false);
                EditorGUILayout.Space();
            }

            var previousName = prefab != null ? prefab.name : "";
            var newPick = (GameObject)EditorGUILayout.ObjectField("Avatar", picked, typeof(GameObject), true);
            if (newPick != picked)
            {
                picked = newPick;
                ResolvePick();
                if (avatarName.Length == 0 || avatarName == previousName) avatarName = prefab != null ? prefab.name : "";
                result = null;
                reportItems = Array.Empty<ReportItem>();
            }
            if (picked != null && sourceProblem != null) EditorGUILayout.HelpBox(sourceProblem, MessageType.Warning);

            EditorGUILayout.Space();
            EditorGUILayout.LabelField("VRM details", EditorStyles.boldLabel);
            avatarName = EditorGUILayout.TextField("Name", avatarName);
            version = EditorGUILayout.TextField("Version", version);
            author = EditorGUILayout.TextField("Author", author);
            copyright = EditorGUILayout.TextField("Copyright", copyright);
            keepPose = EditorGUILayout.Toggle(new GUIContent("Keep modelled pose",
                "Export the pose the Avatar was modelled in instead of the T-pose VRM 1.0 expects. "
                + "Animama straightens A-pose arms when it loads them; other VRM apps may not."), keepPose);

            EditorGUILayout.Space();
            // Dialogs, file panels and the progress bar break the current GUI
            // layout, so every button that opens one ends the pass with ExitGUI.
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.LabelField("Save as", outputPath.Length > 0 ? outputPath : "Not chosen");
                if (GUILayout.Button("Choose…", GUILayout.Width(80)))
                {
                    ChooseOutput();
                    GUIUtility.ExitGUI();
                }
            }

            EditorGUILayout.Space();
            var playing = EditorApplication.isPlayingOrWillChangePlaymode;
            var validateBlockers = ExportBlockers.Find(requirements.AllMet, playing, sourceProblem, modularAvatar, null, export: false);
            var exportBlockers = ExportBlockers.Find(requirements.AllMet, playing, sourceProblem, modularAvatar, outputPath, export: true);
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(validateBlockers.Count > 0))
                {
                    if (GUILayout.Button(new GUIContent("Validate", validateBlockers.FirstOrDefault())))
                    {
                        Run(export: false);
                        GUIUtility.ExitGUI();
                    }
                }
                using (new EditorGUI.DisabledScope(exportBlockers.Count > 0))
                {
                    if (GUILayout.Button(new GUIContent("Export", exportBlockers.FirstOrDefault())))
                    {
                        Run(export: true);
                        GUIUtility.ExitGUI();
                    }
                }
            }
            // The source problem of a picked object is already shown under the Avatar field.
            var blocker = exportBlockers.FirstOrDefault(reason => picked == null || reason != sourceProblem);
            if (blocker != null) EditorGUILayout.HelpBox(blocker, MessageType.Info);

            DrawResult();
            EditorGUILayout.EndScrollView();
        }

        private void ChooseOutput()
        {
            var folder = EditorPrefs.GetString(LastFolderKey, Environment.GetFolderPath(Environment.SpecialFolder.Desktop));
            var name = avatarName.Length > 0 ? avatarName : prefab != null ? prefab.name : "Avatar";
            var path = EditorUtility.SaveFilePanel("Save VRM", folder, name, "vrm");
            if (string.IsNullOrEmpty(path)) return;
            outputPath = path;
            EditorPrefs.SetString(LastFolderKey, Path.GetDirectoryName(path));
        }

        private void Run(bool export)
        {
            var stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage != null && stage.scene.isDirty)
            {
                EditorUtility.DisplayDialog("Save the prefab first", "Save or close the prefab you are editing, then try again.", "OK");
                return;
            }
            // The export reopens the saved scenes afterwards, so unsaved changes must be saved first.
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            if (export && !LicenceNotice.IsAcknowledged(LicenceNotice.DefaultSettingsPath))
            {
                if (!EditorUtility.DisplayDialog(LicenceNotice.Title, LicenceNotice.Text, "I understand", "Cancel")) return;
                LicenceNotice.Acknowledge(LicenceNotice.DefaultSettingsPath);
            }
            // Reopening the scenes replaces a picked scene object, so keep its prefab instead.
            picked = prefab;

            var options = new ExportOptions
            {
                Name = NullIfEmpty(avatarName),
                Version = NullIfEmpty(version),
                Author = NullIfEmpty(author),
                Copyright = NullIfEmpty(copyright),
                KeepPose = keepPose,
            };
            void Progress(string line) =>
                EditorUtility.DisplayProgressBar("Export for Animama", line.Split('\n')[0], 0.5f);
            try
            {
                result = export
                    ? AvatarExporter.Export(prefab, outputPath, options, Progress)
                    : AvatarExporter.Validate(prefab, options, Progress);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
            // The export report adds what only the conversion finds, such as omitted colliders.
            reportItems = ReportExplanations.Explain(result.ExportReport ?? result.ValidationReport);
            ResolvePick();
        }

        private void DrawResult()
        {
            if (result == null) return;
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Result", EditorStyles.boldLabel);
            switch (result.Status)
            {
                case ExportStatus.Exported:
                    EditorGUILayout.HelpBox(
                        $"Saved {result.OutputPath} ({result.Bytes / 1024f / 1024f:0.0} MB). In Animama, choose Upload VRM in Create Anima to use it.",
                        MessageType.Info);
                    if (GUILayout.Button(Application.platform == RuntimePlatform.OSXEditor ? "Show in Finder" : "Show in Explorer"))
                        EditorUtility.RevealInFinder(result.OutputPath);
                    break;
                case ExportStatus.Validated:
                    EditorGUILayout.HelpBox("Ready to export.", MessageType.Info);
                    break;
                case ExportStatus.CannotConvert:
                    EditorGUILayout.HelpBox("Mochiya Avatar Tools cannot convert this Avatar; see the errors below.", MessageType.Error);
                    break;
                default:
                    EditorGUILayout.HelpBox(
                        result.OutputPath != null ? $"{result.Error}\nThe VRM was already saved at {result.OutputPath}." : result.Error,
                        MessageType.Error);
                    break;
            }
            foreach (var item in reportItems)
                EditorGUILayout.HelpBox(item.Count > 1 ? $"{item.Text} ({item.Count})" : item.Text, item.IsError ? MessageType.Error : MessageType.None);

            showLog = EditorGUILayout.Foldout(showLog, "Full log", true);
            if (showLog)
            {
                var log = string.Join("\n", result.Log.Concat(result.Exception != null ? new[] { result.Exception.ToString() } : Array.Empty<string>()));
                EditorGUILayout.TextArea(log, EditorStyles.wordWrappedLabel);
            }
        }

        private static string NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }
}
