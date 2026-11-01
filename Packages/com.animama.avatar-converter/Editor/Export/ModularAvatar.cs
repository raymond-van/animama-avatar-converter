using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Animama.AvatarConverter
{
    /// <summary>
    /// Avatars assembled by Modular Avatar need its build step, which the export
    /// does not run yet, so they are detected and refused. Matched by namespace,
    /// so the package needs no Modular Avatar reference.
    /// </summary>
    internal static class ModularAvatar
    {
        private const string Namespace = "nadena.dev.modular_avatar";

        /// <summary>The type name of the first Modular Avatar component under the root, or null.</summary>
        public static string FindComponent(GameObject root) =>
            FirstModularAvatarType(root.GetComponentsInChildren<MonoBehaviour>(true)
                .Where(component => component != null)
                .Select(component => component.GetType()));

        internal static string FirstModularAvatarType(IEnumerable<Type> componentTypes) =>
            componentTypes.FirstOrDefault(type => type.Namespace != null && type.Namespace.StartsWith(Namespace))?.Name;
    }
}
