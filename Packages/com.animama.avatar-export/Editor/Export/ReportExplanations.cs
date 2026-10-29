using System;
using System.Collections.Generic;
using System.Linq;

namespace Animama.AvatarExport
{
    /// <summary>One line of the explained report.</summary>
    internal sealed class ReportItem
    {
        public ReportItem(bool isError, string text)
        {
            IsError = isError;
            Text = text;
        }

        public bool IsError { get; }

        public string Text { get; }

        /// <summary>How many report lines this item stands for.</summary>
        public int Count { get; set; } = 1;
    }

    /// <summary>
    /// Turns Mochiya's report ("Error:", "Unsupported:" and "Warning:" lines)
    /// into what each expected limitation means in Animama. Matches Mochiya
    /// 0.1.6's own phrases, so an object name or another message cannot be
    /// mistaken for one; other lines are shown as Mochiya wrote them.
    /// </summary>
    internal static class ReportExplanations
    {
        private static readonly (string phrase, string text)[] Known =
        {
            ("custom VRChat Animator state machines are not executed",
                "Animator logic such as gesture expressions and outfit toggles is not converted. Animama drives the face itself."),
            ("VRChat visemes, eyelid blendshapes and eye ranges are translated",
                "Mouth shapes, blinking and eye movement carry over where the Avatar sets them up."),
            ("Only blendshape visemes are converted",
                "Some of this Avatar's mouth shapes are not converted, so its mouth may not move fully when it speaks."),
            ("PhysBone motion is approximated with VRM springs",
                "PhysBones become VRM springs: hair and clothes still move, but cannot be grabbed or stretched."),
            ("Gravity Falloff is baked into the rest-pose gravity strength",
                "Some springs lose PhysBones' gravity falloff, so they hang slightly differently than in VRChat."),
            ("collider has no core VRM sphere/capsule representation",
                "Colliders other than spheres and capsules, such as planes, are left out."),
            ("inside-bounds collision is approximated as an outside collider",
                "Colliders that keep hair or clothes inside a shape keep them outside it instead."),
            ("VRM conversion requires a valid Humanoid Animator",
                "This prefab has no complete humanoid rig. Choose the Avatar's own prefab, not an outfit, accessory or prop."),
            ("has no valid VRM humanoid",
                "This looks like an outfit or accessory, or its humanoid rig is incomplete. Choose the Avatar's own prefab, and check that its model is set up as Humanoid."),
            ("This asset depends on its parent",
                "This looks like an outfit or accessory, not an Avatar. Choose the Avatar's own prefab."),
        };

        public static IReadOnlyList<ReportItem> Explain(string report)
        {
            var items = new List<ReportItem>();
            foreach (var line in (report ?? "").Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0))
            {
                var isError = line.StartsWith("Error:", StringComparison.Ordinal);
                var message = StripPrefix(line);
                var text = Known.FirstOrDefault(known => message.IndexOf(known.phrase, StringComparison.Ordinal) >= 0).text ?? message;
                var existing = items.FirstOrDefault(item => item.IsError == isError && item.Text == text);
                if (existing != null) existing.Count++;
                else items.Add(new ReportItem(isError, text));
            }
            return items;
        }

        private static string StripPrefix(string line)
        {
            foreach (var prefix in new[] { "Error:", "Unsupported:", "Warning:" })
                if (line.StartsWith(prefix, StringComparison.Ordinal)) return line.Substring(prefix.Length).Trim();
            return line;
        }
    }
}
