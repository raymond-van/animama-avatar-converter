using System;
using System.Linq;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace Animama.AvatarConverter
{
    /// <summary>
    /// Runs the export in a fresh empty scene and reopens the user's scenes
    /// afterwards. Mochiya creates its working objects in the active scene, so
    /// they never touch the user's. A new additive scene cannot be used instead:
    /// Unity refuses one while an untitled scene is open, as in batch mode.
    /// Refuses while an open scene has unsaved changes, which reopening would lose.
    /// </summary>
    internal sealed class SceneSetupScope
    {
        private readonly SceneSetup[] saved;

        public SceneSetupScope()
        {
            for (var index = 0; index < SceneManager.sceneCount; index++)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.isDirty)
                    throw new InvalidOperationException(
                        $"Save or discard the changes to the open scene \"{(scene.name.Length > 0 ? scene.name : "Untitled")}\" first; the export works in a temporary scene.");
            }
            saved = ScenesToReopen(EditorSceneManager.GetSceneManagerSetup());
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        }

        /// <summary>
        /// The saved scenes to reopen, with a loaded one active. Untitled scenes
        /// hold nothing unsaved (checked before), so they are not reopened. Unity
        /// needs a loaded active scene, so when no saved scene is loaded none is
        /// reopened and an empty scene is left instead.
        /// </summary>
        internal static SceneSetup[] ScenesToReopen(SceneSetup[] setup)
        {
            var saved = setup.Where(scene => !string.IsNullOrEmpty(scene.path)).ToArray();
            if (!saved.Any(scene => scene.isLoaded)) return Array.Empty<SceneSetup>();
            if (!saved.Any(scene => scene.isActive && scene.isLoaded))
            {
                foreach (var scene in saved) scene.isActive = false;
                saved.First(scene => scene.isLoaded).isActive = true;
            }
            return saved;
        }

        public void Restore()
        {
            if (saved.Length > 0) EditorSceneManager.RestoreSceneManagerSetup(saved);
            else EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        }
    }
}
