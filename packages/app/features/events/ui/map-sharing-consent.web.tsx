"use client";
import { useEffect, useRef } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { MAP_SHARING_DISCLOSURE, useMapSharingPrompt } from "./map-sharing-prompt";

export function MapSharingConsent({ active, promptOnly = false }: { active: boolean; promptOnly?: boolean }) {
  const owner = useAuthStore(state => state.user?.authId);
  return owner ? <OwnedConsent key={owner} owner={owner} active={active} promptOnly={promptOnly} /> : null;
}
function OwnedConsent({ owner, active, promptOnly }: { owner: string; active: boolean; promptOnly: boolean }) {
  // Only the Events-page instance auto-prompts. The map keeps manual controls.
  const flow = useMapSharingPrompt(owner, active, promptOnly);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (flow.open && active) { node?.showModal(); cancelButton.current?.focus(); }
    else if (node?.open) node.close();
    return () => { if (node?.open) node.close(); };
  }, [flow.open, active]);
  const busy = flow.consent.busy || flow.location.busy;
  return <section aria-label="Map sharing" className={promptOnly ? "" : "rounded-xl border border-white/15 p-4 space-y-3"}>
    {!promptOnly ? <>
      {flow.location.sharing ? <>
      <p className="text-sm">Avatar sharing is on until {new Date(flow.location.settings!.shareUntil!).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Your avatar appears when a fresh location is available.</p>
      <button type="button" disabled={flow.location.busy} onClick={flow.stop} className="min-h-11 rounded-xl border border-white/30 px-4">Stop sharing</button>
    </> : <>
      <p className="text-sm text-white/70">Show your avatar on this map for 4 hours. Sharing is optional.</p>
      <button type="button" disabled={!flow.available || busy} onClick={flow.show} className="min-h-11 rounded-xl bg-[#379ED8] px-4 font-semibold text-black disabled:opacity-40">Show my avatar</button>
    </>}
    {flow.location.error ? <div role="alert"><p>{flow.location.error}</p>{flow.location.needsLocationStop ? <button type="button" disabled={flow.location.busy} onClick={() => void flow.location.setOverall(false)} className="min-h-11 underline">Turn all location off</button> : <button type="button" onClick={() => void flow.location.refresh()} className="min-h-11 underline">Reload settings</button>}</div> : null}
    {flow.success && flow.location.sharing ? <p role="status">Your approximate location was shared. Your avatar will appear as the map refreshes.</p> : null}
      {!flow.open && flow.consent.error ? <p role="alert">{flow.consent.error}</p> : null}
    </> : null}
    <dialog ref={dialog} aria-labelledby="map-sharing-title" aria-describedby="map-sharing-description" onCancel={event => { event.preventDefault(); flow.dismiss(); }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl border border-white/20 bg-[#11121d] p-6 text-white backdrop:bg-black/70">
      <h2 id="map-sharing-title" className="text-xl font-semibold">Show your avatar on the map?</h2>
      <p id="map-sharing-description" className="mt-3 text-sm leading-relaxed text-white/80">{MAP_SHARING_DISCLOSURE}</p>
      <p className="mt-3 text-sm text-white/70">Choose Share my location, then Allow if your device asks. Not now keeps you hidden.</p>
      {flow.consent.error ? <p role="alert" className="mt-3 text-sm text-amber-300">{flow.consent.error}</p> : null}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => void flow.share()} className="min-h-11 rounded-xl bg-[#379ED8] px-4 font-semibold text-black disabled:opacity-40">{busy ? "Waiting for location…" : "Share my location"}</button>
        <button ref={cancelButton} type="button" onClick={flow.dismiss} className="min-h-11 rounded-xl border border-white/30 px-4">Not now</button>
      </div>
    </dialog>
  </section>;
}
