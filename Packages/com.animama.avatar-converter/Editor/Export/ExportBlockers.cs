using System.Collections.Generic;
using System.IO;

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
                else if (File.Exists(outputPath)) blockers.Add($"A file already exists at {outputPath}; choose a new name.");
            }
            return blockers;
        }
    }
}
