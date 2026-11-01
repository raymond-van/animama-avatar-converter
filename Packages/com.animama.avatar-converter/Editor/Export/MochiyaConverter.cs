using System.Collections.Generic;
using Mochiya.AvatarTools.Editor;
using UnityEngine;

namespace Animama.AvatarConverter
{
    /// <summary>
    /// Mochiya Avatar Tools' local Detect, Validate and Export. Never calls its
    /// upload workflow.
    /// </summary>
    internal sealed class MochiyaConverter : IAvatarConverter
    {
        private const string DefaultVersion = "1.0";
        private readonly MochiyaExportProfile profile;

        public MochiyaConverter(ExportOptions options, string defaultName)
        {
            profile = ScriptableObject.CreateInstance<MochiyaExportProfile>();
            profile.Metadata.Name = options.Name ?? defaultName;
            profile.Metadata.Version = options.Version ?? DefaultVersion;
            profile.Metadata.Authors = new List<string> { options.Author ?? MochiyaExportProfile.DefaultAuthor };
            profile.Metadata.CopyrightInformation = options.Copyright ?? "";
        }

        public string Detect(GameObject root)
        {
            var target = MochiyaAvatarWorkflow.Detect(root);
            return $"kind={target.Kind} prepared={target.IsPrepared} reason={target.Reason} error={target.Error}";
        }

        public bool Validate(GameObject root, out string report)
        {
            var result = MochiyaAvatarWorkflow.Validate(root, true, profile);
            report = result.ToString();
            return result.CanConvert;
        }

        public string Export(GameObject root, string path) =>
            MochiyaAvatarWorkflow.Export(root, path, profile).ToString();

        public void Dispose() => UnityEngine.Object.DestroyImmediate(profile);
    }
}
