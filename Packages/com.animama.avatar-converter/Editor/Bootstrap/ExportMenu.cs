using System;
using UnityEditor;

namespace Animama.AvatarConverter
{
    /// <summary>
    /// The Animama menu. Its export code compiles only once the dependencies
    /// are installed and registers <see cref="OpenExportWindow"/>; until then
    /// the menu opens the setup window instead.
    /// </summary>
    public static class ExportMenu
    {
        /// <summary>Set by the export assembly when it is compiled.</summary>
        internal static Action OpenExportWindow;

        [MenuItem("Animama/Export for Animama…", priority = 0)]
        private static void Open()
        {
            if (OpenExportWindow != null) OpenExportWindow();
            else SetupWindow.Open();
        }

        [MenuItem("Animama/Check Requirements…", priority = 20)]
        private static void OpenSetup() => SetupWindow.Open();
    }
}
