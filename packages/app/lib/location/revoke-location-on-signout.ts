import { useExactDistanceStore } from "../stores/exact-distance-store";
import { useAuthStore } from "../stores/auth-store";
import { useLocationAccessStore } from "../stores/location-access-store";
import { useEventsLocationStore } from "../stores/events-location-store";
import { memberMapApi } from "../api/member-map";
import { memberProximityApi } from "../api/member-proximity";

/** Before credentials are invalidated, stop local writers and attempt server
 * session detachment. Account-wide consent is not withdrawn by sign-out; sign-out
 * still proceeds, and server session deletion / point expiry bound visibility. */
export async function revokeLocationOnSignOut() {
  const owner = useAuthStore.getState().user?.authId;
  if (!owner) return;
  useExactDistanceStore.getState().beginWithdrawal(owner);
  const access = useLocationAccessStore.getState();
  access.selectOwner(owner);
  useLocationAccessStore.getState().stop("Stopping location for sign-out.");
  const generation = useLocationAccessStore.getState().generation;
  useEventsLocationStore.setState({ deviceLat: null, deviceLng: null, deviceObservation: null, locationMode: "city",
    preciseProximityGrant: false, preciseProximityOwnerAuthId: null, cityVisibility: null });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        const [settings] = await Promise.all([
          memberMapApi.detachSession(owner),
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
    // Session deletion and the 15-minute presence lease bound offline visibility.
    // Never turn a sign-out into an account-wide opt-out or retry as another user.
  } finally { if (timer) clearTimeout(timer); }
}
