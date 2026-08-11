/**
 * Host & Guest WS-8 — the guest's own view of their tier and perk.
 *
 * "The perk is worthless if the member doesn't know they have it." This is the
 * ticket-screen half: a tier chip beside the QR in the same plan colours the
 * roster and the scanner card use, and the perks the server resolved for THIS
 * event underneath it.
 *
 * Two rules from the spec are load-bearing here:
 *  - A non-member sees an **upgrade path, never a taunt**. When there is no
 *    tier we render an invitation, not a "you don't have this" state.
 *  - A guest-checkout buyer sees a **clean, non-judgemental ticket** — pass
 *    `guest` and this renders nothing at all rather than nagging someone who
 *    never made an account to make one.
 */

import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { planAccent, planLabel } from "@dvnt/app/lib/theme/plan-colors";
import { PERK_LABELS, type PerkKey } from "@dvnt/app/lib/perks/perk-config";
import type { PlanKey } from "@dvnt/app/lib/subscription/types";

export function TicketPerkChip({
  planKey,
  perks,
  guest = false,
}: {
  planKey: PlanKey | null | undefined;
  perks?: PerkKey[];
  /** Guest-checkout buyer: no account, so no tier and no upsell. */
  guest?: boolean;
}) {
  const router = useRouter();

  // Nothing to say to someone who bought without an account.
  if (guest) return null;

  const paid = planKey && planKey !== "free";
  const active = perks ?? [];

  if (!paid) {
    // The upgrade path. Framed as what membership adds, never as what this
    // person lacks — and it stays quiet: one line, muted, tappable.
    return (
      <Pressable
        onPress={() => router.push("/settings/membership" as never)}
        className="mt-3 rounded-xl border border-border bg-card px-4 py-3"
        accessibilityRole="button"
        accessibilityLabel="See what membership adds"
      >
        <Text className="text-sm text-muted-foreground">
          Members skip the line at select events.{" "}
          <Text className="font-semibold text-primary">See membership</Text>
        </Text>
      </Pressable>
    );
  }

  const color = planAccent(planKey);

  return (
    <View className="mt-3 items-center gap-2">
      <View
        className="rounded-xl px-4 py-1.5"
        style={{ backgroundColor: `${color}22` }}
        accessibilityRole="text"
        accessibilityLabel={`${planLabel(planKey)} member`}
      >
        <Text
          className="text-[13px] font-extrabold uppercase tracking-wide"
          style={{ color }}
        >
          {planLabel(planKey)}
        </Text>
      </View>

      {active.length > 0 ? (
        <Text className="text-center text-sm font-semibold text-foreground">
          {active.map((p) => PERK_LABELS[p]).join(" · ")}
        </Text>
      ) : (
        // A tier with no perks AT THIS EVENT is honest, not an error: the host
        // simply hasn't enabled any. Saying so beats implying they were denied.
        <Text className="text-center text-xs text-muted-foreground">
          No member perks at this event
        </Text>
      )}
    </View>
  );
}
