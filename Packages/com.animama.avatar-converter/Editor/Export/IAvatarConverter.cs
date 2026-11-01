using System;
using UnityEngine;

namespace Animama.AvatarConverter
{
    /// <summary>The conversion steps the exporter needs from Mochiya; tests substitute a fake.</summary>
    internal interface IAvatarConverter : IDisposable
    {
        /// <summary>A one-line summary of what Mochiya detected at the root.</summary>
        string Detect(GameObject root);

        /// <summary>Whether the root can be exported as VRM, with Mochiya's full report.</summary>
        bool Validate(GameObject root, out string report);

        /// <summary>Writes the VRM to <paramref name="path"/> and returns Mochiya's export report.</summary>
        string Export(GameObject root, string path);
    }
}
