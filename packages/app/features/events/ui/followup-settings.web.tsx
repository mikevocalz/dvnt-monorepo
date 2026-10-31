"use client";
import { useFollowupScope, useFollowupSettings } from "./use-followup-settings";
import { followupTiming } from "@dvnt/app/lib/events/followup-settings";
export function EventFollowupSettings({ eventId }: { eventId: number }) {
  const scope = useFollowupScope(eventId);
  return <Settings key={scope} eventId={eventId} />;
}
function Settings({ eventId }: { eventId: number }) {
  const s = useFollowupSettings(eventId);
  return <section className="rounded-2xl border border-white/10 bg-white/4 p-4 space-y-3" aria-label="Post-party email settings">
    <h2 className="text-base font-semibold">Post-party email</h2>
    <p className="text-sm text-white/60">Optional for this event only. Invite eligible admission ticket holders to rate the event. Unsubscribes are respected.</p>
    {s.loading ? <p role="status">Loading email settings…</p> : null}
    {s.error ? <div role="alert"><p>{s.error}</p><button type="button" onClick={() => void s.reload()} className="text-cyan-300 underline">Reload email settings</button></div> : null}
    {s.settings ? <>
      <label className="flex items-center justify-between gap-3"><span>Send a post-party email</span><input type="checkbox" checked={s.enabled} disabled={s.saving} onChange={e => s.toggle(e.target.checked)} /></label>
      <p className="text-sm text-white/60">Timing: {followupTiming(s.settings.delay_minutes)}. If this time has already passed, enabling schedules delivery on the next processing run.</p>
      <p className="text-sm text-white/60">Saved status: {s.settings.status.replaceAll("_", " ")}. {s.settings.sent_count ?? 0} sent; {s.settings.failed_count ?? 0} failed.</p>
      <button type="button" disabled={s.saving || s.enabled === s.settings.enabled} onClick={() => void s.save()} className="rounded-xl bg-cyan-300 px-4 py-2 text-black font-semibold disabled:opacity-40">{s.saving ? "Saving email settings…" : "Save email setting"}</button>
      <p className="text-xs text-white/50">Saved separately from event details; save any event date changes first. Existing email copy and timing are preserved. Previously emailed attendees are not sent another copy.</p>
      {s.saved ? <p role="status">Email setting saved.</p> : null}
    </> : null}
  </section>;
}
