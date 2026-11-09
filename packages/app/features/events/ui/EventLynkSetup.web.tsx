import React, { useId } from "react";
import { Radio } from "lucide-react";
import { EVENT_LYNK_SETUP as copy, type EventLynkSetupProps } from "./event-lynk-setup";

export function EventLynkSetup({ enabled, onChange, linked = false }: EventLynkSetupProps) {
  const id = useId();
  if (!onChange && !enabled) return null;
  return <div className={`rounded-2xl border p-4 ${enabled ? "border-[#8A40CF]/40 bg-[#8A40CF]/10" : "border-white/10 bg-white/[0.03]"}`} data-testid="event-lynk-setup">
    {onChange ? <label className="flex min-h-12 cursor-pointer items-start gap-3">
      <input type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked)} aria-describedby={id} className="mt-1 h-5 w-5 shrink-0 accent-[#8A40CF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white" />
      <span><span className="block text-sm font-semibold text-white">{copy.label}</span><span id={id} className="mt-1 block text-xs leading-5 text-white/60">{copy.description}</span></span>
    </label> : <div className="flex items-center gap-2 text-sm font-semibold text-white"><Radio size={16} aria-hidden="true" />{linked ? copy.linkedTitle : copy.draftTitle}</div>}
    {enabled ? <div className={onChange ? "mt-4 border-t border-white/10 pt-4" : "mt-3"}>
      <p className="text-xs font-semibold text-[#cda4ef]">{linked ? copy.linkedStatus : copy.draftStatus}</p>
      <ol className="mt-3 space-y-3">{copy.steps.map((step, i) => <li key={step} className="flex items-start gap-2 text-xs leading-5 text-white/65"><span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold">{i + 1}</span><span>{step}</span></li>)}</ol>
    </div> : null}
  </div>;
}
