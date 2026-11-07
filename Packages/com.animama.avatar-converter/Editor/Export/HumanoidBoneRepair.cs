using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Animama.AvatarConverter
{
    /// <summary>
    /// Finds humanoid bones that move nothing and maps them to the bones the
    /// mesh follows.
    ///
    /// Some VRChat Avatars map Unity humanoid bones to helper ("dummy") bones
    /// that skin no vertices, while the mesh follows a chain beside them: for
    /// example humanoid thumbs on <c>Thumb1Dummy</c>–<c>Thumb3Dummy</c> while the
    /// thumb mesh follows <c>Thumb1</c>–<c>Thumb3</c>. A VRM keeps that mapping,
    /// so no motion on those bones shows. Before posing, the exporter gives the
    /// instance a copy of its humanoid Avatar with each such bone moved to its
    /// counterpart, so the T-pose and the VRM both use the real bones; the
    /// source prefab and its Avatar asset stay unchanged.
    /// </summary>
    internal static class HumanoidBoneRepair
    {
        /// <summary>
        /// Bones models often leave unweighted on purpose (eyes moved by blend
        /// shapes, a jaw or toes the mesh ignores). They are never checked.
        /// </summary>
        private static readonly HashSet<HumanBodyBones> Unchecked = new HashSet<HumanBodyBones>
        {
            HumanBodyBones.LeftEye, HumanBodyBones.RightEye, HumanBodyBones.Jaw,
            HumanBodyBones.LeftToes, HumanBodyBones.RightToes,
        };

        /// <summary>
        /// How far a counterpart may lie from the dead bone, as a share of the
        /// dead bone's offset from its parent. Dummy bones sit almost on the real
        /// ones (about 5% of a thumb's base offset apart); another finger lies
        /// much farther.
        /// </summary>
        private const float CounterpartTolerance = 0.25f;

        /// <summary>One humanoid bone moved from the transform it was mapped to.</summary>
        internal sealed class Remap
        {
            public Remap(HumanBodyBones bone, Transform from, Transform to)
            {
                Bone = bone;
                From = from;
                To = to;
            }

            public HumanBodyBones Bone { get; }

            public Transform From { get; }

            public Transform To { get; }
        }

        /// <summary>
        /// Bones to move to the transforms the mesh follows, and checked bones
        /// that move nothing and have no counterpart (left as mapped).
        /// </summary>
        internal sealed class Plan
        {
            public List<Remap> Remaps { get; } = new List<Remap>();

            public List<HumanBodyBones> Unweighted { get; } = new List<HumanBodyBones>();
        }

        /// <summary>What <see cref="Repair"/> did: log lines, report lines and the Avatar it built.</summary>
        internal sealed class Outcome : IDisposable
        {
            private Avatar built;

            internal Outcome(Avatar built, IReadOnlyList<string> log, IReadOnlyList<string> report)
            {
                this.built = built;
                Log = log;
                Report = report;
            }

            /// <summary>Progress lines for the export log.</summary>
            public IReadOnlyList<string> Log { get; }

            /// <summary>"Warning:" lines for the explained report.</summary>
            public IReadOnlyList<string> Report { get; }

            /// <summary>Destroys the Avatar built for the instance, once the export no longer needs it.</summary>
            public void Dispose()
            {
                if (built != null) UnityEngine.Object.DestroyImmediate(built);
                built = null;
            }
        }

        private static readonly IReadOnlyList<string> NoLines = Array.Empty<string>();

        /// <summary>
        /// Checks the instance's humanoid and, when bones move nothing, assigns
        /// its Animator a repaired copy of the Avatar. An instance without a
        /// humanoid Avatar is left alone. Dispose the outcome after the export.
        /// </summary>
        internal static Outcome Repair(GameObject root)
        {
            var animator = root.GetComponent<Animator>();
            if (animator == null || animator.avatar == null || !animator.avatar.isHuman)
                return new Outcome(null, NoLines, NoLines);
            var mapping = new Dictionary<HumanBodyBones, Transform>();
            for (var bone = HumanBodyBones.Hips; bone < HumanBodyBones.LastBone; bone++)
            {
                var transform = animator.GetBoneTransform(bone);
                if (transform != null) mapping[bone] = transform;
            }
            var carries = TransformsMovingTheMesh(root);
            if (carries == null)
                return new Outcome(null, NoLines, new[]
                {
                    "Warning: This Avatar's skin weights could not be read, so humanoid bones that move no part of the model were not checked.",
                });

            var plan = PlanRepair(mapping, carries);
            var log = new List<string>();
            var report = new List<string>();
            var unweighted = new List<HumanBodyBones>(plan.Unweighted);
            Avatar built = null;
            if (plan.Remaps.Count > 0)
            {
                built = BuildRepairedAvatar(animator, plan.Remaps, out var failure);
                if (built != null)
                {
                    animator.avatar = built;
                    animator.Rebind();
                    var moves = string.Join(", ", plan.Remaps.Select(remap =>
                        $"{HumanTrait.BoneName[(int)remap.Bone]} ({remap.From.name} → {remap.To.name})"));
                    log.Add("Mapped humanoid bones that moved nothing to the bones the mesh follows: " + moves);
                    report.Add("Warning: Some humanoid bones pointed at bones that move no part of the model, so the VRM uses the bones beside them that the mesh follows: " + moves + ".");
                }
                else
                {
                    log.Add("Could not map humanoid bones that move nothing to the bones the mesh follows: " + failure);
                    report.Add($"Warning: These humanoid bones move no part of the model, and the bones beside them that the mesh follows could not be used ({failure}), so their motion won't show in Animama: "
                        + string.Join(", ", plan.Remaps.Select(remap => HumanTrait.BoneName[(int)remap.Bone])) + ".");
                }
            }
            if (unweighted.Count > 0)
                report.Add("Warning: These humanoid bones move no part of the model, and no bone beside them that the mesh follows could replace them, so their motion won't show in Animama: "
                    + string.Join(", ", unweighted.Select(bone => HumanTrait.BoneName[(int)bone])) + ".");
            return new Outcome(built, log, report);
        }

        /// <summary>
        /// The transforms that move the mesh themselves: a skinned mesh's bone
        /// some vertex weighs above zero, the transform of a skinned mesh with no
        /// bones or of a mesh drawn by a MeshRenderer, or the source of a VRM 1.0
        /// constraint, whose target follows it. Mochiya keeps only VRM 1.0
        /// constraints, so a Unity or VRChat constraint does not count: the VRM
        /// loses it, and its source stops moving the bones it drove. Inactive
        /// objects count, as the export keeps them. Null when a skinned mesh's
        /// weights cannot be read.
        /// </summary>
        internal static HashSet<Transform> TransformsMovingTheMesh(GameObject root)
        {
            var carries = new HashSet<Transform>();
            foreach (var renderer in root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mesh = renderer.sharedMesh;
                if (mesh == null) continue;
                var bones = renderer.bones;
                if (bones == null || bones.Length == 0)
                {
                    carries.Add(renderer.transform);
                    continue;
                }
                try
                {
                    var weights = mesh.GetAllBoneWeights();
                    // A readable mesh without weights simply has none.
                    if (weights.Length == 0 && mesh.vertexCount > 0 && !mesh.isReadable) return null;
                    foreach (var weight in weights)
                    {
                        if (!(weight.weight > 0) || weight.boneIndex < 0 || weight.boneIndex >= bones.Length) continue;
                        var bone = bones[weight.boneIndex];
                        if (bone != null) carries.Add(bone);
                    }
                }
                catch (Exception error) when (error is UnityException || error is InvalidOperationException)
                {
                    return null;
                }
            }
            foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true))
                if (filter.sharedMesh != null && filter.GetComponent<MeshRenderer>() != null) carries.Add(filter.transform);
            foreach (var constraint in root.GetComponentsInChildren<UniVRM10.IVrm10Constraint>(true))
                if (constraint.ConstraintSource != null) carries.Add(constraint.ConstraintSource);
            return carries;
        }

        /// <summary>
        /// Plans the repair of humanoid bones that move nothing: neither the bone
        /// nor any transform below it moves the mesh (<paramref name="carries"/>,
        /// from <see cref="TransformsMovingTheMesh"/>). Eyes, jaw and toes are not checked.
        ///
        /// A dead bone and the checked bones below it form a run, repaired
        /// together or not at all. Its counterpart is the nearest other child of
        /// the dead bone's parent that moves something, is no humanoid bone, and
        /// lies within <see cref="CounterpartTolerance"/> of the dead bone's offset
        /// from its parent. Each bone below follows the same path down the
        /// counterpart, taking at each step the nearest child that is no humanoid
        /// bone. A run with no counterpart, or whose path cannot be followed, is
        /// reported as unweighted. Bones one run takes are not offered to the next.
        /// </summary>
        internal static Plan PlanRepair(IReadOnlyDictionary<HumanBodyBones, Transform> mapping, ISet<Transform> carries)
        {
            var moves = new Dictionary<Transform, bool>();
            bool MovesSomething(Transform transform)
            {
                if (moves.TryGetValue(transform, out var known)) return known;
                var result = carries.Contains(transform);
                foreach (Transform child in transform)
                    if (!result && MovesSomething(child)) result = true;
                moves[transform] = result;
                return result;
            }

            var mapped = new HashSet<Transform>(mapping.Values.Where(transform => transform != null));
            var dead = mapping
                .Where(pair => pair.Value != null && !Unchecked.Contains(pair.Key) && !MovesSomething(pair.Value))
                .OrderBy(pair => Depth(pair.Value))
                .ThenBy(pair => (int)pair.Key)
                .ToList();

            var plan = new Plan();
            var handled = new HashSet<HumanBodyBones>();
            foreach (var pair in dead)
            {
                if (handled.Contains(pair.Key)) continue;
                var root = pair.Value;
                var run = dead.Where(member => !handled.Contains(member.Key) && member.Value.IsChildOf(root)).ToList();
                foreach (var member in run) handled.Add(member.Key);
                var resolved = ResolveRun(run, root, mapped, MovesSomething);
                if (resolved != null)
                {
                    plan.Remaps.AddRange(resolved);
                    foreach (var remap in resolved) mapped.Add(remap.To);
                }
                else plan.Unweighted.AddRange(run.Select(member => member.Key));
            }
            return plan;
        }

        private static List<Remap> ResolveRun(
            List<KeyValuePair<HumanBodyBones, Transform>> run,
            Transform root,
            HashSet<Transform> mapped,
            Func<Transform, bool> movesSomething)
        {
            var parent = root.parent;
            if (parent == null) return null;
            var offset = Vector3.Distance(root.position, parent.position);
            if (!(offset > 0)) return null;
            var candidates = Children(parent)
                .Where(child => child != root && !mapped.Contains(child) && movesSomething(child)
                    && Vector3.Distance(child.position, root.position) <= CounterpartTolerance * offset)
                .ToList();
            if (candidates.Count == 0) return null;
            var counterpart = Nearest(candidates, root);

            var result = new List<Remap>();
            foreach (var member in run)
            {
                // The path from the run's root down to this bone, root excluded.
                var steps = new List<Transform>();
                for (var at = member.Value; at != root; at = at.parent) steps.Add(at);
                steps.Reverse();
                var target = counterpart;
                foreach (var step in steps)
                {
                    var options = Children(target).Where(child => !mapped.Contains(child)).ToList();
                    if (options.Count == 0) return null;
                    target = Nearest(options, step);
                }
                result.Add(new Remap(member.Key, member.Value, target));
            }
            return result.Select(remap => remap.To).Distinct().Count() == result.Count ? result : null;
        }

        /// <summary>
        /// A copy of the Animator's humanoid Avatar with each remapped bone on its
        /// new transform, or null with a reason when Unity cannot build it (for
        /// example when the new bone's name is not unique in the hierarchy).
        /// </summary>
        internal static Avatar BuildRepairedAvatar(Animator animator, IReadOnlyList<Remap> remaps, out string failure)
        {
            failure = null;
            var source = animator.avatar;
            var root = animator.transform;
            var nameCounts = root.GetComponentsInChildren<Transform>(true)
                .GroupBy(transform => transform.name)
                .ToDictionary(group => group.Key, group => group.Count());
            var description = source.humanDescription;
            var human = description.human;
            foreach (var remap in remaps)
            {
                if (nameCounts.TryGetValue(remap.To.name, out var count) && count > 1)
                {
                    failure = $"more than one object is named {remap.To.name}";
                    return null;
                }
                var index = Array.FindIndex(human, bone => bone.humanName == HumanTrait.BoneName[(int)remap.Bone]);
                if (index < 0)
                {
                    failure = $"the Avatar does not list {HumanTrait.BoneName[(int)remap.Bone]}";
                    return null;
                }
                human[index].boneName = remap.To.name;
            }
            description.human = human;
            // The skeleton lists every transform the Avatar knows; add any new bone it lacks.
            var skeleton = description.skeleton.ToList();
            var listed = new HashSet<string>(skeleton.Select(bone => bone.name));
            foreach (var remap in remaps)
                for (var at = remap.To; at != null && at != root; at = at.parent)
                    if (listed.Add(at.name))
                        skeleton.Add(new SkeletonBone { name = at.name, position = at.localPosition, rotation = at.localRotation, scale = at.localScale });
            description.skeleton = skeleton.ToArray();

            var avatar = AvatarBuilder.BuildHumanAvatar(animator.gameObject, description);
            if (avatar == null || !avatar.isValid || !avatar.isHuman)
            {
                if (avatar != null) UnityEngine.Object.DestroyImmediate(avatar);
                failure = "Unity could not build a humanoid Avatar with them";
                return null;
            }
            avatar.name = source.name;
            return avatar;
        }

        private static IEnumerable<Transform> Children(Transform parent)
        {
            foreach (Transform child in parent) yield return child;
        }

        private static Transform Nearest(IEnumerable<Transform> options, Transform to) =>
            options.OrderBy(option => Vector3.Distance(option.position, to.position)).First();

        private static int Depth(Transform transform)
        {
            var depth = 0;
            for (var at = transform.parent; at != null; at = at.parent) depth++;
            return depth;
        }
    }
}
