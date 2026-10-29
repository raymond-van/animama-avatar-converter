using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace Animama.AvatarExport
{
    /// <summary>
    /// Validates and exports a VRChat Avatar prefab as VRM 1.0 for Animama.
    ///
    /// Each run instantiates the prefab in a temporary scene, strips EditorOnly
    /// objects as a VRChat build does, poses the humanoid T-pose (unless
    /// <see cref="ExportOptions.KeepPose"/>), then runs Mochiya's Detect,
    /// Validate and Export. The source prefab and the user's scenes are left
    /// unchanged. The VRM is written beside the target under a temporary name and
    /// moved into place only when complete; an existing file is never overwritten.
    /// Nothing is uploaded.
    /// </summary>
    public static class AvatarExporter
    {
        private const int MoveAttempts = 5;
        private const int MoveRetryMilliseconds = 200;

        /// <summary>
        /// Runs Mochiya's validation without writing a file. <paramref name="progress"/>
        /// receives each log line as it happens.
        /// </summary>
        public static ExportResult Validate(GameObject prefab, ExportOptions options, Action<string> progress = null) =>
            Run(prefab, null, options, CreateConverter, progress);

        /// <summary>
        /// Validates, then writes the VRM to <paramref name="outPath"/> (a new .vrm
        /// path). <paramref name="progress"/> receives each log line as it happens.
        /// </summary>
        public static ExportResult Export(GameObject prefab, string outPath, ExportOptions options, Action<string> progress = null) =>
            Run(prefab, outPath ?? throw new ArgumentNullException(nameof(outPath)), options, CreateConverter, progress);

        private static IAvatarConverter CreateConverter(ExportOptions options, string defaultName) =>
            new MochiyaConverter(options, defaultName);

        /// <summary>Validates, and exports when <paramref name="outPath"/> is given, with the given converter.</summary>
        internal static ExportResult Run(
            GameObject prefab,
            string outPath,
            ExportOptions options,
            Func<ExportOptions, string, IAvatarConverter> createConverter,
            Action<string> progress = null)
        {
            var result = new ExportResult(progress);
            string partialPath = null;
            try
            {
                if (prefab == null || !PrefabUtility.IsPartOfPrefabAsset(prefab) || prefab.transform.parent != null)
                    throw new ArgumentException("Choose the root of a prefab asset to export.");
                if (outPath != null)
                {
                    outPath = Path.GetFullPath(outPath);
                    if (!string.Equals(Path.GetExtension(outPath), ".vrm", StringComparison.OrdinalIgnoreCase))
                        throw new ArgumentException("The output file must end in .vrm: " + outPath);
                    if (File.Exists(outPath)) throw new IOException("Output exists; choose a new path: " + outPath);
                }

                var scenes = new SceneSetupScope();
                try
                {
                    using (var converter = createConverter(options, prefab.name))
                    {
                        var root = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
                        StripEditorOnly(root, result.Add);
                        Pose(root, options.KeepPose, result);

                        result.Add("Detect: " + converter.Detect(root));
                        var canConvert = converter.Validate(root, out var report);
                        result.ValidationReport = report;
                        result.Add("Validate:\n" + report);
                        if (!canConvert)
                        {
                            result.Status = ExportStatus.CannotConvert;
                            return result;
                        }
                        if (outPath == null)
                        {
                            result.Status = ExportStatus.Validated;
                            return result;
                        }

                        partialPath = PartialPath(outPath);
                        result.ExportReport = converter.Export(root, partialPath);
                        result.Add("Export report:\n" + result.ExportReport);
                        MoveIntoPlace(partialPath, outPath);
                        partialPath = null;
                        result.OutputPath = outPath;
                        ImportIfInsideAssets(outPath);
                    }
                }
                finally
                {
                    RestoreScenes(scenes, result);
                }

                result.Bytes = new FileInfo(outPath).Length;
                result.Status = ExportStatus.Exported;
                result.Add($"Wrote {outPath} ({result.Bytes} bytes)");
            }
            catch (Exception error)
            {
                result.Exception = error;
                result.Status = ExportStatus.Failed;
            }
            finally
            {
                RemovePartial(partialPath, result);
            }
            return result;
        }

        /// <summary>
        /// VRChat strips objects tagged EditorOnly when it builds an Avatar, and
        /// outfit variants hide a garment that way, but Mochiya exports them, so a
        /// hidden garment would come back in the VRM. Removes them, as a build would.
        /// </summary>
        internal static void StripEditorOnly(GameObject root, Action<string> log)
        {
            var tagged = new List<GameObject>();
            foreach (var transform in root.GetComponentsInChildren<Transform>(true))
            {
                if (!transform.CompareTag("EditorOnly")) continue;
                // Removing the topmost tagged object removes the ones below it.
                var ancestor = transform.parent;
                while (ancestor != null && !ancestor.CompareTag("EditorOnly")) ancestor = ancestor.parent;
                if (ancestor == null) tagged.Add(transform.gameObject);
            }
            if (tagged.Count == 0) return;
            // A prefab instance's own objects cannot be removed until it is unpacked.
            if (PrefabUtility.IsPartOfPrefabInstance(root))
                PrefabUtility.UnpackPrefabInstance(root, PrefabUnpackMode.Completely, InteractionMode.AutomatedAction);
            foreach (var gameObject in tagged)
            {
                log("Stripped EditorOnly object " + gameObject.name);
                UnityEngine.Object.DestroyImmediate(gameObject);
            }
        }

        /// <summary>
        /// VRM 1.0 requires a T-pose rest pose, and VRChat Avatars are often
        /// modelled in an A-pose, so the instance takes its Unity humanoid T-pose
        /// first, like UniVRM's "T-Pose (unity internal)".
        /// </summary>
        private static void Pose(GameObject root, bool keepPose, ExportResult result)
        {
            if (keepPose)
            {
                result.Add("Kept the modelled pose (keep-pose option); VRM 1.0 expects a T-pose.");
                return;
            }
            var animator = root.GetComponent<Animator>();
            if (animator == null || animator.avatar == null || !animator.avatar.isHuman)
                throw new InvalidOperationException(
                    "The prefab root has no humanoid Animator avatar to take the T-pose from; use the keep-pose option to export the modelled pose.");
            if (!UniGLTF.InternalTPose.TryMakePoseValid(root))
                throw new InvalidOperationException("Could not apply the humanoid T-pose; use the keep-pose option to export the modelled pose.");
            result.Add("Applied the humanoid T-pose.");
        }

        /// <summary>
        /// A temporary name beside the target. The leading dot keeps Unity from
        /// importing it inside Assets; Mochiya requires the .vrm extension.
        /// </summary>
        private static string PartialPath(string outPath) =>
            Path.Combine(
                Path.GetDirectoryName(outPath),
                $".{Path.GetFileNameWithoutExtension(outPath)}.{Guid.NewGuid().ToString("N").Substring(0, 8)}.partial.vrm");

        /// <summary>
        /// Moves the finished file into place without overwriting. Retries briefly
        /// while Windows (for example a virus scanner) still holds the new file.
        /// </summary>
        private static void MoveIntoPlace(string partialPath, string outPath)
        {
            for (var attempt = 1; ; attempt++)
            {
                try
                {
                    File.Move(partialPath, outPath);
                    return;
                }
                catch (IOException) when (attempt < MoveAttempts && !File.Exists(outPath))
                {
                    Thread.Sleep(MoveRetryMilliseconds);
                }
            }
        }

        /// <summary>Imports an export written inside Assets, as Mochiya does for its own output.</summary>
        private static void ImportIfInsideAssets(string outPath)
        {
            var assets = Path.GetFullPath(Application.dataPath).Replace('\\', '/') + "/";
            if (outPath.Replace('\\', '/').StartsWith(assets, StringComparison.OrdinalIgnoreCase)) AssetDatabase.Refresh();
        }

        /// <summary>A failed reopen is reported without replacing the run's own outcome.</summary>
        private static void RestoreScenes(SceneSetupScope scenes, ExportResult result)
        {
            try
            {
                scenes.Restore();
            }
            catch (Exception error)
            {
                result.Add("Could not reopen the open scenes; reopen them from the Project window: " + error.Message);
            }
        }

        private static void RemovePartial(string partialPath, ExportResult result)
        {
            if (partialPath == null || !File.Exists(partialPath)) return;
            try
            {
                File.Delete(partialPath);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                result.Add($"Could not remove the temporary file {partialPath}: {error.Message}");
            }
        }
    }
}
