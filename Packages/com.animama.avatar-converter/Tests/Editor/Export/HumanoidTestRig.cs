using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Animama.AvatarConverter.Tests
{
    /// <summary>
    /// A generated humanoid in a T-pose with a skinned body: every humanoid bone
    /// and the extra bones listed carry one vertex each. The left thumb can map
    /// to dummy bones that skin nothing, beside a skinned thumb chain, as some
    /// VRChat Avatars are rigged.
    /// </summary>
    internal sealed class HumanoidTestRig : IDisposable
    {
        /// <summary>What the left thumb maps to and what lies beside it.</summary>
        internal enum Thumb
        {
            /// <summary>The humanoid thumb is the skinned chain.</summary>
            Clean,

            /// <summary>Dummies beside a full skinned chain.</summary>
            DummiesBesideChain,

            /// <summary>Dummies beside a skinned chain one bone short.</summary>
            DummiesBesideShortChain,
        }

        private static readonly (string name, string parent, Vector3 at, HumanBodyBones? bone)[] Body =
        {
            ("Hips", null, new Vector3(0, 1, 0), HumanBodyBones.Hips),
            ("Spine", "Hips", new Vector3(0, 0.1f, 0), HumanBodyBones.Spine),
            ("Chest", "Spine", new Vector3(0, 0.15f, 0), HumanBodyBones.Chest),
            ("Neck", "Chest", new Vector3(0, 0.15f, 0), HumanBodyBones.Neck),
            ("Head", "Neck", new Vector3(0, 0.1f, 0), HumanBodyBones.Head),
            ("Shoulder_L", "Chest", new Vector3(0.05f, 0.1f, 0), HumanBodyBones.LeftShoulder),
            ("UpperArm_L", "Shoulder_L", new Vector3(0.1f, 0, 0), HumanBodyBones.LeftUpperArm),
            ("LowerArm_L", "UpperArm_L", new Vector3(0.25f, 0, 0), HumanBodyBones.LeftLowerArm),
            ("Hand_L", "LowerArm_L", new Vector3(0.25f, 0, 0), HumanBodyBones.LeftHand),
            ("Index1_L", "Hand_L", new Vector3(0.06f, 0, 0.01f), HumanBodyBones.LeftIndexProximal),
            ("Index2_L", "Index1_L", new Vector3(0.03f, 0, 0), HumanBodyBones.LeftIndexIntermediate),
            ("Index3_L", "Index2_L", new Vector3(0.02f, 0, 0), HumanBodyBones.LeftIndexDistal),
            ("Shoulder_R", "Chest", new Vector3(-0.05f, 0.1f, 0), HumanBodyBones.RightShoulder),
            ("UpperArm_R", "Shoulder_R", new Vector3(-0.1f, 0, 0), HumanBodyBones.RightUpperArm),
            ("LowerArm_R", "UpperArm_R", new Vector3(-0.25f, 0, 0), HumanBodyBones.RightLowerArm),
            ("Hand_R", "LowerArm_R", new Vector3(-0.25f, 0, 0), HumanBodyBones.RightHand),
            ("UpperLeg_L", "Hips", new Vector3(0.1f, -0.05f, 0), HumanBodyBones.LeftUpperLeg),
            ("LowerLeg_L", "UpperLeg_L", new Vector3(0, -0.45f, 0), HumanBodyBones.LeftLowerLeg),
            ("Foot_L", "LowerLeg_L", new Vector3(0, -0.45f, 0.05f), HumanBodyBones.LeftFoot),
            ("UpperLeg_R", "Hips", new Vector3(-0.1f, -0.05f, 0), HumanBodyBones.RightUpperLeg),
            ("LowerLeg_R", "UpperLeg_R", new Vector3(0, -0.45f, 0), HumanBodyBones.RightLowerLeg),
            ("Foot_R", "LowerLeg_R", new Vector3(0, -0.45f, 0.05f), HumanBodyBones.RightFoot),
        };

        private static readonly HumanBodyBones[] ThumbBones =
        {
            HumanBodyBones.LeftThumbProximal, HumanBodyBones.LeftThumbIntermediate, HumanBodyBones.LeftThumbDistal,
        };

        private static readonly (string name, string parent, Vector3 at)[] Dummies =
        {
            ("Thumb1Dummy_L", "Hand_L", new Vector3(0.019f, 0, 0.015f)),
            ("Thumb2Dummy_L", "Thumb1Dummy_L", new Vector3(0.03f, 0, 0.012f)),
            ("Thumb3Dummy_L", "Thumb2Dummy_L", new Vector3(0.02f, 0, 0.006f)),
        };

        /// <summary>The skinned thumb, about a millimetre from the dummies and slightly bent.</summary>
        private static readonly (string name, string parent, Vector3 at)[] RealThumb =
        {
            ("Thumb1_L", "Hand_L", new Vector3(0.018f, 0.001f, 0.016f)),
            ("Thumb2_L", "Thumb1_L", new Vector3(0.03f, -0.002f, 0.011f)),
            ("Thumb3_L", "Thumb2_L", new Vector3(0.02f, -0.002f, 0.005f)),
        };

        private readonly Dictionary<string, Transform> transforms = new Dictionary<string, Transform>();

        public HumanoidTestRig(Thumb thumb = Thumb.DummiesBesideChain)
        {
            Root = new GameObject("Avatar");
            var armature = new GameObject("Armature").transform;
            armature.SetParent(Root.transform, false);
            transforms["Armature"] = armature;
            foreach (var (name, parent, at, _) in Body) Add(name, parent ?? "Armature", at);
            var real = thumb == Thumb.DummiesBesideShortChain ? RealThumb.Take(2) : RealThumb;
            foreach (var (name, parent, at) in real) Add(name, parent, at);
            if (thumb != Thumb.Clean)
                foreach (var (name, parent, at) in Dummies) Add(name, parent, at);

            Mapping = Body.Where(entry => entry.bone.HasValue).ToDictionary(entry => entry.bone.Value, entry => transforms[entry.name]);
            var thumbChain = thumb == Thumb.Clean ? RealThumb.Select(entry => entry.name) : Dummies.Select(entry => entry.name);
            foreach (var (bone, name) in ThumbBones.Zip(thumbChain, (bone, name) => (bone, name)))
                Mapping[bone] = transforms[name];

            var weighted = Body.Select(entry => transforms[entry.name]).Concat(real.Select(entry => transforms[entry.name])).ToArray();
            Skin(transforms.Values.Where(transform => transform != armature).ToArray(), weighted);
        }

        public GameObject Root { get; }

        /// <summary>The humanoid mapping the rig's Avatar uses.</summary>
        public Dictionary<HumanBodyBones, Transform> Mapping { get; }

        public Mesh Mesh { get; private set; }

        public Transform this[string name] => transforms[name];

        /// <summary>Builds the rig's humanoid Avatar from <see cref="Mapping"/> and gives the root an Animator using it.</summary>
        public Avatar AddAnimator()
        {
            var description = new HumanDescription
            {
                human = Mapping.Select(pair => new HumanBone
                {
                    humanName = HumanTrait.BoneName[(int)pair.Key],
                    boneName = pair.Value.name,
                    limit = new HumanLimit { useDefaultValues = true },
                }).ToArray(),
                skeleton = Root.GetComponentsInChildren<Transform>(true).Select(transform => new SkeletonBone
                {
                    name = transform.name,
                    position = transform.localPosition,
                    rotation = transform.localRotation,
                    scale = transform.localScale,
                }).ToArray(),
                upperArmTwist = 0.5f,
                lowerArmTwist = 0.5f,
                upperLegTwist = 0.5f,
                lowerLegTwist = 0.5f,
                armStretch = 0.05f,
                legStretch = 0.05f,
            };
            var avatar = AvatarBuilder.BuildHumanAvatar(Root, description);
            avatar.name = "Avatar";
            var animator = Root.GetComponent<Animator>();
            if (animator == null) animator = Root.AddComponent<Animator>();
            animator.avatar = avatar;
            return avatar;
        }

        public void Dispose()
        {
            // Unity objects compare to null through their own operator, so no ?. here.
            var animator = Root != null ? Root.GetComponent<Animator>() : null;
            var avatar = animator != null ? animator.avatar : null;
            if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
            if (avatar != null && string.IsNullOrEmpty(UnityEditor.AssetDatabase.GetAssetPath(avatar))) UnityEngine.Object.DestroyImmediate(avatar);
            if (Mesh != null && string.IsNullOrEmpty(UnityEditor.AssetDatabase.GetAssetPath(Mesh))) UnityEngine.Object.DestroyImmediate(Mesh);
        }

        private void Add(string name, string parent, Vector3 at)
        {
            var transform = new GameObject(name).transform;
            transform.SetParent(transforms[parent], false);
            transform.localPosition = at;
            transforms[name] = transform;
        }

        /// <summary>A body mesh over <paramref name="bones"/> with one vertex weighted fully to each of <paramref name="weighted"/>.</summary>
        private void Skin(Transform[] bones, Transform[] weighted)
        {
            var body = new GameObject("Body");
            body.transform.SetParent(Root.transform, false);
            Mesh = new Mesh { name = "Body" };
            Mesh.vertices = weighted.Select(bone => bone.position).ToArray();
            Mesh.boneWeights = weighted.Select(bone => new BoneWeight { boneIndex0 = Array.IndexOf(bones, bone), weight0 = 1 }).ToArray();
            Mesh.bindposes = bones.Select(bone => bone.worldToLocalMatrix * Root.transform.localToWorldMatrix).ToArray();
            var renderer = body.AddComponent<SkinnedMeshRenderer>();
            renderer.sharedMesh = Mesh;
            renderer.bones = bones;
            renderer.rootBone = transforms["Hips"];
        }
    }
}
