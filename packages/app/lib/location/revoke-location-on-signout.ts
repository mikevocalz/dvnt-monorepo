import { useExactDistanceStore } from "../stores/exact-distance-store";
import { useAuthStore } from "../stores/auth-store";
import { useLocationAccessStore } from "../stores/location-access-store";
import { useEventsLocationStore } from "../stores/events-location-store";
import { memberMapApi } from "../api/member-map";
import { memberProximityApi } from "../api/member-proximity";

/** Before credentials are invalidated, stop local writers and attempt server
 * withdrawal. Offline withdrawal remains a durable negative intent; sign-out
 * still proceeds, and server session deletion / point expiry bound visibility. */
export async function revokeLocationOnSignOut() {
  const owner = useAuthStore.getState().user?.authId;
  if (!owner) return;
  useExactDistanceStore.getState().beginWithdrawal(owner);
  const access = useLocationAccessStore.getState();
  access.selectOwner(owner);
  useLocationAccessStore.getState().stop("Stopping location for sign-out.", true);
  const generation = useLocationAccessStore.getState().generation;
  useEventsLocationStore.setState({ deviceLat: null, deviceLng: null, deviceObservation: null, locationMode: "city",
    preciseProximityGrant: false, preciseProximityOwnerAuthId: null, cityVisibility: null });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const [settings] = await Promise.all([
          memberMapApi.revoke(owner, "overall"),
          memberProximityApi.revokeExact(owner),
        ]);
        if (useAuthStore.getState().user?.authId === owner) {
          useLocationAccessStore.getState().accept(owner, settings, false, generation);
          useExactDistanceStore.getState().confirmWithdrawal(owner);
        }
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Offline withdrawal")), 3000); }),
    ]);
  } catch {
    // Do not erase the pending withdrawal or retry with another user's token.
  } finally { if (timer) clearTimeout(timer); }
}
