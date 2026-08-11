/**
 * Host & Guest WS-5/WS-8 — the consent ask, in context.
 *
 * Asked where it lands (the ticket screen), with the honest benefit stated and
 * the honest limit stated. Off by default, refusable at no cost, and revocable
 * from this same row — which is the "one obvious place" the spec requires.
 *
 * Copy is deliberate: it names what the host sees ("that you're nearby") and
 * what they don't ("your location never leaves your phone"), because that is
 * literally true of the implementation — the device sends a state word and the
 * table has no coordinate column to put anything else in.
 */

import { View, Text } from "react-native";
import { useState } from "react";
import { Switch } from "@dvnt/app/components/ui/switch";
import { revokeArrivalPresence } from "./arrival-presence";
import { usePresenceConsentStore } from "./presence-consent-store";

export function ArrivalConsentRow({
  eventId,
  ticketId,
}: {
  eventId: string;
  ticketId: string;
}) {
  const consented = usePresenceConsentStore((s) => s.isConsented(eventId));
  const setConsent = usePresenceConsentStore((s) => s.setConsent);
  const [busy, setBusy] = useState(false);

  const onToggle = async (next: boolean) => {
    setBusy(true);
    try {
      // Local consent flips first so the switch never lags the finger. On
      // revoke the server delete is what actually matters, so it is awaited —
      // "revocation is immediate" is an accept criterion, not a nicety.
      setConsent(eventId, next);
      if (!next) await revokeArrivalPresence({ eventId, ticketId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="mt-3 rounded-xl border border-border bg-card p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1">
          <Text className="font-medium text-foreground">
            Let the host know you're close
          </Text>
          <Text className="mt-1 text-xs text-muted-foreground">
            So they can move you through the line. Your location never leaves
            your phone — the host only sees that you're nearby.
          </Text>
        </View>
        <Switch
          checked={consented}
          disabled={busy}
          onCheckedChange={(v) => void onToggle(v)}
        />
      </View>
      <Text className="mt-2 text-[11px] text-muted-foreground">
        Off by default. Turning it off deletes what the host can see straight
        away — your ticket and entry are unaffected either way.
      </Text>
    </View>
  );
}
