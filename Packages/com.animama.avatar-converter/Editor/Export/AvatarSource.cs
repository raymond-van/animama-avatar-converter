using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Animama.AvatarConverter
{
    /// <summary>
    /// Turns the object the user picked into the prefab asset to export. The
    /// export instantiates a prefab in a temporary scene, so an Avatar in the
    /// open scene is exported through its prefab, and only when it has no
    /// changes the prefab lacks.
    /// </summary>
    internal static class AvatarSource
    {
        private const string ChooseInProject = "Choose the Avatar's prefab in the Project window instead.";

        public static GameObject Resolve(GameObject picked, out string problem)
        {
            problem = null;
            if (picked == null)
            {
                problem = "Choose the Avatar's prefab.";
                return null;
            }
            if (EditorUtility.IsPersistent(picked))
            {
                if (picked.transform.parent == null && PrefabUtility.IsPartOfPrefabAsset(picked)) return picked;
                problem = "Choose the prefab's root object.";
                return null;
            }
            if (PrefabStageUtility.GetPrefabStage(picked) != null)
            {
                problem = "This object is open in Prefab Mode. " + ChooseInProject;
                return null;
            }
            if (!PrefabUtility.IsPartOfPrefabInstance(picked))
            {
                problem = "Save this Avatar as a prefab (drag it into the Project window), then choose the prefab.";
                return null;
            }
            if (!PrefabUtility.IsOutermostPrefabInstanceRoot(picked))
            {
                problem = "This is not the root of a prefab in the scene. " + ChooseInProject;
                return null;
            }
            if (PrefabUtility.HasPrefabInstanceAnyOverrides(picked, false))
            {
                problem = "This Avatar has changes in the scene that its prefab does not, so it would not export as shown. "
                    + "Apply them to the prefab, or choose the prefab in the Project window to export it as saved.";
                return null;
            }
            return PrefabUtility.GetCorrespondingObjectFromSource(picked);
        }
    }
}
