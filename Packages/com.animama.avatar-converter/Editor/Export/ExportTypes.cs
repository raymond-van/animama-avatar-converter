using System;
using System.Collections.Generic;
using System.Linq;

namespace Animama.AvatarConverter
{
    /// <summary>VRM metadata and posing for one export. Null metadata fields take their defaults.</summary>
    public sealed class ExportOptions
    {
        /// <summary>The Avatar's name; defaults to the prefab's name.</summary>
        public string Name;

        /// <summary>The Avatar's version; defaults to "1.0".</summary>
        public string Version;

        /// <summary>The author; defaults to Mochiya's default author.</summary>
        public string Author;

        /// <summary>Copyright or credit text; defaults to empty.</summary>
        public string Copyright;

        /// <summary>
        /// Export the modelled pose instead of the humanoid T-pose that VRM 1.0
        /// expects. Animama normalizes A-pose arms at load; other VRM tools may not.
        /// </summary>
        public bool KeepPose;
    }

    public enum ExportStatus
    {
        /// <summary>Validation passed; no file was requested.</summary>
        Validated,

        /// <summary>The VRM was written to <see cref="ExportResult.OutputPath"/>.</summary>
        Exported,

        /// <summary>Mochiya's validation found errors; nothing was written.</summary>
        CannotConvert,

        /// <summary>
        /// The export stopped with <see cref="ExportResult.Error"/>. Nothing was
        /// written unless <see cref="ExportResult.OutputPath"/> is set: the VRM was
        /// already in place when a later step failed.
        /// </summary>
        Failed,
    }

    /// <summary>The outcome of one validation or export, with its progress log.</summary>
    public sealed class ExportResult
    {
        private readonly List<string> log = new List<string>();
        private readonly Action<string> progress;

        internal ExportResult(Action<string> progress) => this.progress = progress;

        public ExportStatus Status { get; internal set; }

        /// <summary>The written VRM; set once it is in place, normally with <see cref="Status"/> Exported.</summary>
        public string OutputPath { get; internal set; }

        /// <summary>The written VRM's size in bytes.</summary>
        public long Bytes { get; internal set; }

        /// <summary>Why the export failed, when <see cref="Status"/> is Failed.</summary>
        public string Error => Exception?.Message;

        public Exception Exception { get; internal set; }

        /// <summary>Mochiya's validation report ("Error:", "Unsupported:" and "Warning:" lines), once validation ran.</summary>
        public string ValidationReport { get; internal set; }

        /// <summary>
        /// Mochiya's export report, once the export ran: the validation lines plus
        /// those only the conversion finds, such as omitted colliders.
        /// </summary>
        public string ExportReport { get; internal set; }

        /// <summary>
        /// "Warning:" lines about humanoid bones that move no part of the model:
        /// those mapped to the bones the mesh follows, and those left as they
        /// were. Null when every humanoid bone moves something.
        /// </summary>
        public string RepairReport { get; internal set; }

        /// <summary>
        /// The lines the window and the command explain: <see cref="RepairReport"/>,
        /// then Mochiya's export report, or its validation report when no export ran.
        /// </summary>
        internal string ReportToExplain =>
            string.Join("\n", new[] { RepairReport, ExportReport ?? ValidationReport }.Where(part => !string.IsNullOrEmpty(part)));

        /// <summary>
        /// Progress lines in order: stripped objects, posing, Mochiya's detection,
        /// validation and export reports, and the written file.
        /// </summary>
        public IReadOnlyList<string> Log => log;

        internal void Add(string line)
        {
            log.Add(line);
            progress?.Invoke(line);
        }
    }
}
