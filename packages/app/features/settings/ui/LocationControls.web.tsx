"use client";
import { getGoogleMapsPublicKey } from "@dvnt/ui/google-maps-public-config";
import { useEffect, useState } from "react";
import { useLocationSettings, useMapSharingConsent } from "@dvnt/app/lib/hooks/use-member-map";

import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function LocationControls({ allowSharing = Boolean(getGoogleMapsPublicKey()) }: { allowSharing?: boolean }) {
  const location = useLocationSettings();
  const consent = useMapSharingConsent(allowSharing);
  const owner = useAuthStore(state => state.user?.authId);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setConfirm(false); }, [owner]);
  const share = async () => { if (allowSharing && await consent.share() && useAuthStore.getState().user?.authId === owner) setConfirm(false); };
  const dismiss = () => { consent.cancel(); setConfirm(false); };
  const unavailable = location.loading || location.busy || consent.busy || !location.settings;
  return <section aria-label="Location settings" className="mt-4 rounded-2xl border border-white/10 bg-white/4 p-4">
    <h2 className="font-semibold text-white">Location</h2>
    <div className="flex items-center justify-between gap-4 py-3">
      <div><p className="font-semibold">Use device location</p><p className="text-sm text-white/60">Overall DVNT location control. Turning this off stops location updates and removes you from the Events people map. You can still choose a city manually.</p></div>
      <button type="button" role="switch" aria-label="Use device location" aria-checked={location.enabled} disabled={unavailable} onClick={() => void location.setOverall(!location.enabled)} className="min-h-11 shrink-0 rounded-xl border border-white/20 px-4 disabled:opacity-40">{location.enabled ? "On" : "Off"}</button>
    </div>
    <div className="flex items-center justify-between gap-4 border-t border-white/10 py-3">
      <div><p className="font-semibold">Show my avatar on Events map</p><p className="text-sm text-white/60">Share your approximate area with eligible nearby members for four hours. This does not show your exact position or say which event you attend.</p></div>
      <button type="button" role="switch" aria-label="Show my avatar on Events map" aria-checked={location.sharing} disabled={unavailable || (!location.sharing && (!location.enabled || !allowSharing))} onClick={() => { if (location.sharing) void location.setSharing(false); else setConfirm(true); }} className="min-h-11 shrink-0 rounded-xl border border-white/20 px-4 disabled:opacity-40">{location.sharing ? "On" : "Off"}</button>
    </div>
    {confirm && location.enabled && allowSharing ? <div role="group" aria-label="Confirm map sharing" className="rounded-xl border border-[#379ED8]/50 p-3">
      <p className="text-sm">Your avatar, profile name and approximate area (about 1 km) will be visible to eligible nearby members. Only foreground updates are used. Sharing expires after four hours, and your pin disappears if your location is over 15 minutes old. You can turn it off here anytime. Device/browser permission is separate.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={unavailable} onClick={() => void share()} className="min-h-11 rounded-xl bg-[#379ED8] px-4 font-semibold text-black">Share my approximate area for 4 hours</button><button type="button" onClick={dismiss} className="min-h-11 rounded-xl border border-white/20 px-4">Cancel</button></div>
    </div> : null}
    {location.sharing && location.settings?.shareUntil ? <p className="mt-2 text-sm text-white/60">Sharing until {new Date(location.settings.shareUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Your approximate location updates automatically while the Events map is open. Allow device/browser location if asked.</p> : null}
    {consent.error ? <p role="alert" className="mt-3 text-sm text-amber-300">{consent.error}</p> : null}
    {consent.busy ? <p role="status">Waiting for location permission and a fresh location…</p> : null}
    {location.loading ? <p role="status">Loading location settings…</p> : null}
    {location.error ? <div role="alert" className="mt-3 text-sm text-amber-300"><p>{location.error}</p>{location.needsLocationStop ? <button type="button" disabled={location.busy} onClick={() => void location.setOverall(false)} className="min-h-11 underline mr-4">Turn all location off</button> : location.failedEnable === "sharing" && location.enabled && allowSharing ? <button type="button" disabled={unavailable} onClick={() => setConfirm(true)} className="min-h-11 underline mr-4">Retry avatar sharing</button> : location.failedEnable === "overall" ? <button type="button" disabled={unavailable} onClick={() => void location.setOverall(true)} className="min-h-11 underline mr-4">Retry turning location on</button> : null}<button type="button" onClick={() => void location.refresh()} className="min-h-11 underline">Reload settings</button></div> : null}
    {!allowSharing ? <p className="mt-2 text-sm text-white/60">People map is unavailable on this device. No map location is being collected.</p> : null}
  </section>;
}
