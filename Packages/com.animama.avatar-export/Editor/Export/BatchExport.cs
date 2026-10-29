using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Animama.AvatarExport
{
    /// <summary>
    /// Batch-mode entry points for the Animama command line:
    ///
    ///   Unity -batchmode -quit -projectPath &lt;project&gt; -logFile &lt;log&gt; \
    ///     -executeMethod Animama.AvatarExport.BatchExport.Validate|Export \
    ///     -animamaPrefab Assets/.../Avatar.prefab [-animamaOut /abs/path/Avatar.vrm] \
    ///     [-animamaName …] [-animamaVersion …] [-animamaAuthor …] [-animamaCopyright …] \
    ///     [-animamaKeepPose]   (the keep-pose option: export the modelled pose)
    ///
    /// Never pass -nographics: the exporter reads compressed textures back
    /// through the GPU and writes flat grey placeholders without one.
    /// Each log line starts with "[Animama]". Like the window, it refuses a
    /// project that misses a requirement or an Avatar that needs Modular Avatar,
    /// and ends with the report explained in plain language ("[Animama] Note:"
    /// and "[Animama] Error:" lines). Exit codes: 0 validated or exported, 2
    /// Mochiya cannot convert the prefab (or it needs Modular Avatar), 3 a
    /// requirement is not met, 1 any other failure.
    /// </summary>
    public static class BatchExport
    {
        public const int CannotConvertExitCode = 2;

        public static void Validate() => Run(export: false);

        public static void Export() => Run(export: true);

        private static void Run(bool export)
        {
            var exitCode = 1;
            try
            {
                var prefabPath = Arg("-animamaPrefab");
                if (string.IsNullOrEmpty(prefabPath)) throw new ArgumentException("-animamaPrefab is required.");
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                if (prefab == null) throw new FileNotFoundException("Prefab not found: " + prefabPath);
                var unmet = Requirements.Check().Where(status => !status.IsMet).ToList();
                if (unmet.Count > 0)
                {
                    foreach (var status in unmet) Debug.LogError("[Animama] Requirement not met: " + status.Describe());
                    EditorApplication.Exit(BatchRequirements.NotReadyExitCode);
                    return;
                }
                var modularAvatar = ModularAvatar.FindComponent(prefab);
                if (modularAvatar != null)
                {
                    Debug.LogError(
                        $"[Animama] Not supported: this Avatar uses Modular Avatar ({modularAvatar}); Avatars that need a Modular Avatar build are not supported yet.");
                    EditorApplication.Exit(CannotConvertExitCode);
                    return;
                }
                var options = new ExportOptions
                {
                    Name = Arg("-animamaName"),
                    Version = Arg("-animamaVersion"),
                    Author = Arg("-animamaAuthor"),
                    Copyright = Arg("-animamaCopyright"),
                    KeepPose = HasArg("-animamaKeepPose"),
                };
                // Each line is logged as it happens, so a crash or kill mid-export keeps the lines before it.
                void Progress(string line) => Debug.Log("[Animama] " + line);
                ExportResult result;
                if (export)
                {
                    var outPath = Arg("-animamaOut");
                    if (string.IsNullOrEmpty(outPath)) throw new ArgumentException("-animamaOut is required for Export.");
                    result = AvatarExporter.Export(prefab, outPath, options, Progress);
                }
                else result = AvatarExporter.Validate(prefab, options, Progress);

                // The same plain-language report as the window.
                foreach (var item in ReportExplanations.Explain(result.ExportReport ?? result.ValidationReport))
                    Debug.Log($"[Animama] {(item.IsError ? "Error" : "Note")}: {item.Text}{(item.Count > 1 ? $" ({item.Count})" : "")}");
                if (result.Status == ExportStatus.Failed) Debug.LogError("[Animama] Failed: " + result.Exception);
                exitCode = result.Status == ExportStatus.CannotConvert ? CannotConvertExitCode : result.Status == ExportStatus.Failed ? 1 : 0;
            }
            catch (Exception error)
            {
                Debug.LogError("[Animama] Failed: " + error);
            }
            EditorApplication.Exit(exitCode);
        }

        private static bool HasArg(string name) => Array.IndexOf(Environment.GetCommandLineArgs(), name) >= 0;

        private static string Arg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            var index = Array.IndexOf(args, name);
            return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
        }
    }
}
