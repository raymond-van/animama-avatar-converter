using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Animama.AvatarExport
{
    /// <summary>
    /// Batch-mode requirement check for the command line:
    /// <c>-executeMethod Animama.AvatarExport.BatchRequirements.Check</c>.
    /// Logs one "[Animama] Requirement" line per component; exits 0 when every
    /// requirement is met, 3 otherwise. Compiles without the dependencies.
    /// </summary>
    public static class BatchRequirements
    {
        public const int NotReadyExitCode = 3;

        public static void Check()
        {
            var statuses = Requirements.Check();
            foreach (var status in statuses)
                Debug.Log($"[Animama] Requirement {(status.IsMet ? "met" : status.State.ToString().ToLowerInvariant())}: {status.Describe()}");
            EditorApplication.Exit(statuses.All(status => status.IsMet) ? 0 : NotReadyExitCode);
        }
    }
}
