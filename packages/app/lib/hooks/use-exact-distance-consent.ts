import { sampleExactDistance } from "@dvnt/app/lib/location/sample-exact-distance";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useLocationAccessStore } from "@dvnt/app/lib/stores/location-access-store";
import { useExactDistanceStore } from "@dvnt/app/lib/stores/exact-distance-store";
import { memberProximityApi } from "@dvnt/app/lib/api/member-proximity";
let writes: Promise<unknown> = Promise.resolve();
// Epoch invalidation runs even while the settings component is unmounted.
let consentEpoch = 0;
useAuthStore.subscribe((next, previous) => {
  if (next.user?.authId !== previous.user?.authId || next.authStatus !== previous.authStatus) {
    consentEpoch += 1;
    const local = useExactDistanceStore.getState();
    if (!next.user?.authId || (local.owner && local.owner !== next.user.authId)) local.clear();
  }
});
useLocationAccessStore.subscribe((next, previous) => {
  if (next.owner !== previous.owner || next.settings?.sessionKey !== previous.settings?.sessionKey) {
    consentEpoch += 1;
    const local = useExactDistanceStore.getState();
    // Initial settings hydration may restore the same grant. Never show it
    // before fresh settings, but don't silently forget a still-live consent.
    if ((local.owner && next.owner && local.owner !== next.owner) ||
        (local.sessionKey && next.settings?.sessionKey && local.sessionKey !== next.settings.sessionKey) ||
        (previous.settings?.sessionKey && !next.settings?.sessionKey)) local.clear();
  }
});
export function useExactDistanceConsent() {
  const owner = useAuthStore(s => s.user?.authId);
  const local = useExactDistanceStore();
  const access = useLocationAccessStore();
  const sessionKey = access.settings?.sessionKey;
  const withdrawalPending = !!owner && local.pendingWithdrawals[owner] === true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const client = useQueryClient();
  const enabled = !!owner && local.owner === owner && local.sessionKey === sessionKey &&
    Date.now() < local.expiresAt && !withdrawalPending && access.hydrationReady && !access.blocked && access.owner === owner && access.settings?.locationEnabled === true;
  const update = async (next: boolean) => {
    if (next && !useExactDistanceStore.getState().hydrationReady) {
      setError("Exact distance privacy preferences could not be read. Keep sharing off and retry after device storage is available.");
      return;
    }
    if (!owner || (next && (!sessionKey || withdrawalPending || !access.hydrationReady || access.blocked || access.owner !== owner))) return;
    setBusy(true); setError(null);
    if (!next) useExactDistanceStore.getState().beginWithdrawal(owner);
    else useExactDistanceStore.getState().clear();
    const generation = useExactDistanceStore.getState().generation;
    const epoch = consentEpoch;
    client.removeQueries({ queryKey: ["member-proximity"] });
    const operation = writes.catch(() => {}).then(async () => {
      if (useAuthStore.getState().user?.authId !== owner) return;
      if (!next) {
        await memberProximityApi.revokeExact(owner);
        useExactDistanceStore.getState().confirmWithdrawal(owner);
        return;
      }
      if (useLocationAccessStore.getState().settings?.sessionKey !== sessionKey ||
          useExactDistanceStore.getState().generation !== generation || consentEpoch !== epoch) return;
      const sampleAllowed = () => useAuthStore.getState().user?.authId === owner &&
        useLocationAccessStore.getState().settings?.sessionKey === sessionKey &&
        !useLocationAccessStore.getState().blocked &&
        useLocationAccessStore.getState().settings?.locationEnabled === true &&
        useExactDistanceStore.getState().generation === generation && consentEpoch === epoch;
      await sampleExactDistance(owner, sessionKey!, sampleAllowed);
      if (!sampleAllowed()) return;
      const response = await memberProximityApi.consentExact(owner, sessionKey!);
      if (useAuthStore.getState().user?.authId === owner &&
          useLocationAccessStore.getState().settings?.sessionKey === sessionKey &&
          useExactDistanceStore.getState().generation === generation && consentEpoch === epoch) {
        useExactDistanceStore.getState().accept(owner, sessionKey!, Date.parse(response.expiresAt));
      } else {
        // Never accept a late positive response. Retain durable negative intent
        // until the server confirms withdrawal for the original account.
        useExactDistanceStore.getState().beginWithdrawal(owner);
        if (useAuthStore.getState().user?.authId === owner) {
          await memberProximityApi.revokeExact(owner);
          useExactDistanceStore.getState().confirmWithdrawal(owner);
        }
      }
    });
    writes = operation;
    try { await operation; } catch { setError(next ? "Could not enable exact distances. Allow device location and retry with a fresh location." : "Could not confirm withdrawal. Retry Stop exact distances."); }
    finally { setBusy(false); }
  };
  return { enabled, busy, error, update, withdrawalPending };
}
