using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;

namespace Animama.AvatarExport
{
    /// <summary>
    /// Installs the supported UniGLTF, UniVRM 1.0 and Mochiya Avatar Tools
    /// through Unity's Package Manager. Called only after the user agrees.
    /// </summary>
    public static class DependencyInstaller
    {
        public const string GitDownloadUrl = "https://git-scm.com/downloads";

        /// <summary>Whether Git runs; Unity needs it to install packages from Git URLs.</summary>
        public static bool GitAvailable()
        {
            try
            {
                using (var git = Process.Start(new ProcessStartInfo("git", "--version")
                       {
                           UseShellExecute = false,
                           CreateNoWindow = true,
                           RedirectStandardOutput = true,
                           RedirectStandardError = true,
                       }))
                {
                    git.WaitForExit(10000);
                    return git.HasExited && git.ExitCode == 0;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// Adds every URL in one request, so UniGLTF and UniVRM resolve before
        /// Mochiya, which depends on them by version. Calls <paramref name="done"/>
        /// with null on success or the Package Manager's error.
        /// </summary>
        public static void Install(IReadOnlyList<string> urls, Action<string> done)
        {
            var request = Client.AddAndRemove(urls.ToArray());
            void Poll()
            {
                if (!request.IsCompleted) return;
                EditorApplication.update -= Poll;
                done(request.Status == StatusCode.Success ? null : request.Error?.message ?? "The Package Manager failed.");
            }
            EditorApplication.update += Poll;
        }
    }
}
