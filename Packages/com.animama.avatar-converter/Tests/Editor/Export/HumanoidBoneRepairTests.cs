using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Animama.AvatarConverter.Tests
{
    /// <summary>
    /// Humanoid bones that move nothing: the plan, the skin-weight reading and
    /// the repaired Avatar, on generated rigs.
    /// </summary>
    public class HumanoidBoneRepairTests
    {
        private static readonly HumanBodyBones[] Thumb =
        {
            HumanBodyBones.LeftThumbProximal, HumanBodyBones.LeftThumbIntermediate, HumanBodyBones.LeftThumbDistal,
        };

        [Test]
        public void ReadsWhichBonesTheSkinWeighs()
        {
            using (var rig = new HumanoidTestRig())
            {
                var carries = HumanoidBoneRepair.TransformsMovingTheMesh(rig.Root);

                // Transforms enumerate their children, so NUnit's collection
                // constraints would compare them as collections; check by reference.
                Assert.That(carries.Contains(rig["Thumb2_L"]), Is.True);
                Assert.That(carries.Contains(rig["Head"]), Is.True);
                Assert.That(carries.Contains(rig["Thumb2Dummy_L"]), Is.False);
            }
        }

        [Test]
        public void MovesADummyThumbChainToTheSkinnedChainBesideIt()
        {
            using (var rig = new HumanoidTestRig())
            {
                var plan = Plan(rig);

                Assert.That(Describe(plan), Is.EqualTo(new[]
                {
                    "LeftThumbProximal: Thumb1Dummy_L -> Thumb1_L",
                    "LeftThumbIntermediate: Thumb2Dummy_L -> Thumb2_L",
                    "LeftThumbDistal: Thumb3Dummy_L -> Thumb3_L",
                }));
                Assert.That(plan.Unweighted, Is.Empty);
            }
        }

        [Test]
        public void LeavesACleanRigAlone()
        {
            using (var rig = new HumanoidTestRig(HumanoidTestRig.Thumb.Clean))
            {
                var plan = Plan(rig);

                Assert.That(plan.Remaps, Is.Empty);
                Assert.That(plan.Unweighted, Is.Empty);
            }
        }

        [Test]
        public void LeavesTheWholeChainWhenTheCounterpartIsTooShort()
        {
            using (var rig = new HumanoidTestRig(HumanoidTestRig.Thumb.DummiesBesideShortChain))
            {
                var plan = Plan(rig);

                Assert.That(plan.Remaps, Is.Empty);
                Assert.That(plan.Unweighted, Is.EqualTo(Thumb));
            }
        }

        [Test]
        public void DoesNotTakeASiblingFartherThanAQuarterOfTheBonesOffset()
        {
            using (var rig = new HumanoidTestRig())
            {
                rig["Thumb1_L"].localPosition = new Vector3(0.03f, 0.01f, 0.02f);

                var plan = Plan(rig);

                Assert.That(plan.Remaps, Is.Empty);
                Assert.That(plan.Unweighted, Is.EqualTo(Thumb));
            }
        }

        [Test]
        public void NeverTakesABoneAnotherHumanoidBoneUses()
        {
            using (var rig = new HumanoidTestRig())
            {
                // The middle finger is mapped to an unweighted bone where the index lies.
                var dummy = new GameObject("MiddleDummy_L").transform;
                dummy.SetParent(rig["Hand_L"], false);
                dummy.localPosition = new Vector3(0.06f, 0, 0.011f);
                var mapping = new Dictionary<HumanBodyBones, Transform>(rig.Mapping) { [HumanBodyBones.LeftMiddleProximal] = dummy };

                var plan = HumanoidBoneRepair.PlanRepair(mapping, HumanoidBoneRepair.TransformsMovingTheMesh(rig.Root));

                Assert.That(plan.Unweighted, Has.Member(HumanBodyBones.LeftMiddleProximal));
                Assert.That(plan.Remaps.Select(remap => remap.Bone), Has.No.Member(HumanBodyBones.LeftMiddleProximal));
            }
        }

        [Test]
        public void KeepsADummyChainThatDrivesTheSkinnedChainThroughAVrmConstraint()
        {
            using (var rig = new HumanoidTestRig())
            {
                foreach (var (real, dummy) in new[] { ("Thumb1_L", "Thumb1Dummy_L"), ("Thumb2_L", "Thumb2Dummy_L"), ("Thumb3_L", "Thumb3Dummy_L") })
                    rig[real].gameObject.AddComponent<UniVRM10.Vrm10RotationConstraint>().Source = rig[dummy];

                var plan = Plan(rig);

                Assert.That(plan.Remaps, Is.Empty);
                Assert.That(plan.Unweighted, Is.Empty);
            }
        }

        [Test]
        public void NeverGivesTwoRunsTheSameBone()
        {
            using (var rig = new HumanoidTestRig(HumanoidTestRig.Thumb.Clean))
            {
                var mapping = new Dictionary<HumanBodyBones, Transform>(rig.Mapping);
                var real = new GameObject("Real_L").transform;
                real.SetParent(rig["Hand_L"], false);
                real.localPosition = new Vector3(0.031f, 0.02f, 0.02f);
                foreach (var (bone, name, z) in new[] { (HumanBodyBones.LeftMiddleProximal, "DummyA_L", 0.02f), (HumanBodyBones.LeftLittleProximal, "DummyB_L", 0.021f) })
                {
                    var dummy = new GameObject(name).transform;
                    dummy.SetParent(rig["Hand_L"], false);
                    dummy.localPosition = new Vector3(0.03f, 0.02f, z);
                    mapping[bone] = dummy;
                }
                var carries = HumanoidBoneRepair.TransformsMovingTheMesh(rig.Root);
                carries.Add(real);

                var plan = HumanoidBoneRepair.PlanRepair(mapping, carries);

                Assert.That(plan.Remaps, Has.Count.EqualTo(1));
                Assert.That(plan.Remaps[0].To == real, Is.True);
                Assert.That(plan.Unweighted, Has.Count.EqualTo(1));
            }
        }

        [Test]
        public void CountsAMeshRendererUnderABoneAsMovingIt()
        {
            using (var rig = new HumanoidTestRig(HumanoidTestRig.Thumb.Clean))
            {
                var mapping = new Dictionary<HumanBodyBones, Transform>(rig.Mapping);
                var tip = new GameObject("Nail");
                var bone = new GameObject("IndexTip_L").transform;
                bone.SetParent(rig["Index3_L"], false);
                tip.transform.SetParent(bone, false);
                tip.AddComponent<MeshFilter>().sharedMesh = rig.Mesh;
                tip.AddComponent<MeshRenderer>();
                mapping[HumanBodyBones.LeftIndexDistal] = bone;

                var plan = HumanoidBoneRepair.PlanRepair(mapping, HumanoidBoneRepair.TransformsMovingTheMesh(rig.Root));

                Assert.That(plan.Unweighted, Is.Empty);
            }
        }

        [Test]
        public void IgnoresEyesJawAndToes()
        {
            using (var rig = new HumanoidTestRig(HumanoidTestRig.Thumb.Clean))
            {
                var mapping = new Dictionary<HumanBodyBones, Transform>(rig.Mapping);
                foreach (var (bone, parent) in new[]
                {
                    (HumanBodyBones.LeftEye, "Head"), (HumanBodyBones.Jaw, "Head"), (HumanBodyBones.LeftToes, "Foot_L"),
                })
                {
                    var unweighted = new GameObject(bone.ToString()).transform;
                    unweighted.SetParent(rig[parent], false);
                    unweighted.localPosition = new Vector3(0.02f, 0.02f, 0.05f);
                    mapping[bone] = unweighted;
                }

                var plan = HumanoidBoneRepair.PlanRepair(mapping, HumanoidBoneRepair.TransformsMovingTheMesh(rig.Root));

                Assert.That(plan.Remaps, Is.Empty);
                Assert.That(plan.Unweighted, Is.Empty);
            }
        }

        [Test]
        public void GivesTheInstanceARepairedAvatarAndLeavesTheSourceAlone()
        {
            using (var rig = new HumanoidTestRig())
            {
                var source = rig.AddAnimator();
                Assume.That(source.isValid && source.isHuman, "the generated rig builds a humanoid Avatar");
                var animator = rig.Root.GetComponent<Animator>();

                using (var outcome = HumanoidBoneRepair.Repair(rig.Root))
                {
                    Assert.That(animator.avatar, Is.Not.SameAs(source));
                    Assert.That(Thumb.Select(bone => animator.GetBoneTransform(bone).name),
                        Is.EqualTo(new[] { "Thumb1_L", "Thumb2_L", "Thumb3_L" }));
                    Assert.That(source.humanDescription.human.Single(bone => bone.humanName == "Left Thumb Proximal").boneName,
                        Is.EqualTo("Thumb1Dummy_L"), "the source Avatar keeps its mapping");
                    Assert.That(outcome.Report, Has.Count.EqualTo(1));
                    Assert.That(outcome.Report[0], Does.StartWith("Warning: ").And.Contain("Left Thumb Proximal (Thumb1Dummy_L → Thumb1_L)"));
                    Assert.That(outcome.Log, Has.Some.Contains("Thumb3Dummy_L → Thumb3_L"));
                    var repaired = animator.avatar;
                    outcome.Dispose();
                    Assert.That(repaired == null, Is.True, "disposing destroys the built Avatar");
                }
                animator.avatar = source;
            }
        }

        [Test]
        public void ReportsBonesItCannotRepairAndKeepsTheAvatar()
        {
            using (var rig = new HumanoidTestRig(HumanoidTestRig.Thumb.DummiesBesideShortChain))
            {
                var source = rig.AddAnimator();
                Assume.That(source.isValid && source.isHuman, "the generated rig builds a humanoid Avatar");

                using (var outcome = HumanoidBoneRepair.Repair(rig.Root))
                {
                    Assert.That(rig.Root.GetComponent<Animator>().avatar, Is.SameAs(source));
                    Assert.That(outcome.Report, Has.Count.EqualTo(1));
                    Assert.That(outcome.Report[0], Does.StartWith("Warning: ")
                        .And.Contain("Left Thumb Proximal, Left Thumb Intermediate, Left Thumb Distal"));
                }
            }
        }

        [Test]
        public void ReportsNothingForACleanRig()
        {
            using (var rig = new HumanoidTestRig(HumanoidTestRig.Thumb.Clean))
            {
                var source = rig.AddAnimator();

                using (var outcome = HumanoidBoneRepair.Repair(rig.Root))
                {
                    Assert.That(rig.Root.GetComponent<Animator>().avatar, Is.SameAs(source));
                    Assert.That(outcome.Report, Is.Empty);
                    Assert.That(outcome.Log, Is.Empty);
                }
            }
        }

        private static HumanoidBoneRepair.Plan Plan(HumanoidTestRig rig) =>
            HumanoidBoneRepair.PlanRepair(rig.Mapping, HumanoidBoneRepair.TransformsMovingTheMesh(rig.Root));

        private static IEnumerable<string> Describe(HumanoidBoneRepair.Plan plan) =>
            plan.Remaps.Select(remap => $"{remap.Bone}: {remap.From.name} -> {remap.To.name}");
    }
}
