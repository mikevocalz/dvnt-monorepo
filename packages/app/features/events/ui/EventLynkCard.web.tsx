import React from "react";
import { ArrowUpRight, Radio, ShieldCheck, Users } from "lucide-react";
import { waitingSinceLabel } from "../../../lib/events/event-lynk";
import { eventLynkCardModel, eventLynkWaitingLabel, type EventLynkCardProps } from "./event-lynk-card-model";

export function EventLynkCard(props: EventLynkCardProps) {
  const m = eventLynkCardModel(props);
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#8A40CF]/15 via-[#18151e] to-[#121216]" data-testid="event-lynk-card">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/70"><Radio size={16} aria-hidden="true" /> Event Lynk</span>
          <span role="status" className={`rounded-full border px-3 py-1 text-xs font-medium ${m.live ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/5 text-white/70"}`}>{m.badge}</span>
        </div>
        <h3 className="mt-5 text-xl font-semibold tracking-tight text-white">{m.title}</h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65">{m.description}</p>
        <button type="button" data-lynk-room={props.roomId} data-testid="event-lynk-open" disabled={m.disabled} aria-busy={props.isOpening || m.loading} onClick={props.onOpen}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#8A40CF] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#9b53df] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-default disabled:opacity-60 sm:w-auto sm:min-w-56">
          {m.action}<ArrowUpRight size={17} aria-hidden="true" />
        </button>
        {!m.terminal ? <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-white/60"><ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{m.guidance}</p> : null}
        {m.error ? <div role="alert" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">Waiting room unavailable. Your guest list hasn’t been refreshed.<button type="button" onClick={props.onRetry} className="mt-2 block min-h-11 rounded-md px-2 font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2">Retry waiting room</button></div> : null}
      </div>
      {m.showRoster && props.view ? <div className="border-t border-white/10 bg-black/10 p-5 sm:px-6" data-testid="event-lynk-host-panel">
        <div className="flex items-center gap-2"><Users size={16} className="text-white/60" aria-hidden="true" /><p className="text-sm font-semibold text-white" aria-live="polite">{eventLynkWaitingLabel(props.view.count)}</p></div>
        <p className="mt-1 text-xs leading-relaxed text-white/55">Host-only waiting count. Identities stay private.</p>
        {props.view.waiting.length ? <ul aria-label="People waiting for this event Lynk" tabIndex={0} className="mt-3 max-h-56 space-y-1 overflow-y-auto overscroll-contain rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          {props.view.waiting.map(w => { const name = "Member waiting"; return <li key={w.userId} className="flex min-h-12 items-center gap-3 py-1.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60"><Users size={14} /></span>
            <span className="min-w-0 flex-1 truncate text-sm text-white" title={name}>{name}</span><span className="shrink-0 text-xs text-white/55">{waitingSinceLabel(w.joinedAt)}</span>
          </li>; })}
        </ul> : <p className="mt-4 rounded-xl border border-dashed border-white/10 px-4 py-4 text-sm leading-relaxed text-white/60">You can start when you’re ready. Eligible guests will arrive here before the room opens.</p>}
      </div> : null}
    </div>
  );
}
