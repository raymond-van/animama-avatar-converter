using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace Animama.AvatarConverter
{
    /// <summary>Why the window's Validate or Export button is unavailable, in order.</summary>
    internal static class ExportBlockers
    {
        public static IReadOnlyList<string> Find(
            bool requirementsMet, bool playing, string sourceProblem, string modularAvatarComponent, string outputPath, bool export)
        {
            var blockers = new List<string>();
            if (!requirementsMet) blockers.Add("Fix the requirements above first.");
            if (playing) blockers.Add("Exit Play Mode first.");
            if (sourceProblem != null) blockers.Add(sourceProblem);
            if (modularAvatarComponent != null)
                blockers.Add($"This Avatar uses Modular Avatar ({modularAvatarComponent}). Avatars that need a Modular Avatar build are not supported yet.");
            if (export)
            {
                if (string.IsNullOrEmpty(outputPath)) blockers.Add("Choose where to save the VRM.");
                else if (File.Exists(outputPath)) blockers.Add(FileExists(outputPath));
            }
            return blockers;
        }

        /// <summary>
        /// The Export blocker to show under the buttons, or null. Leaves out a
        /// source problem already shown under the Avatar field, and the file the
        /// window has just saved, which exists because the export succeeded.
        /// </summary>
        public static string Hint(IReadOnlyList<string> exportBlockers, string shownSourceProblem, string outputPath, string exportedPath) =>
            exportBlockers.FirstOrDefault(reason =>
                reason != shownSourceProblem
                && !(exportedPath != null && exportedPath == outputPath && reason == FileExists(outputPath)));

        private static string FileExists(string path) => $"A file already exists at {path}; choose a new name.";
    }
}
