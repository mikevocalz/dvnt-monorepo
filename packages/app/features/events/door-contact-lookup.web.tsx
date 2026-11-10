"use client";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { checkPhone } from "@dvnt/app/lib/checkout/profile-fields";
import { hasAdmissionPurpose } from "@dvnt/app/lib/tickets/ticket-category";
import { isAdmissible } from "@dvnt/app/lib/tickets/ticket-access";

/** Contact lookup is online, explicit-submit, ephemeral and never roster-cached. */
export function DoorContactLookup({ eventId, onCheckIn, checkingInToken }: {
  eventId: string; onCheckIn: (token: string) => void; checkingInToken: string | null;
}) {
  const account = useAuthStore(s => s.user?.authId || String(s.user?.id || ""));
  const scope = `${eventId}:${account}`;
  const useLookup = useMemo(() => create<{
    value: string; kind: "email" | "phone"; busy: boolean; error: string; rows: TicketRecord[] | null; revision: number;
    patch: (p: Partial<{ value: string; kind: "email" | "phone"; busy: boolean; error: string; rows: TicketRecord[] | null; revision: number }>) => void;
  }>(set => ({ value: "", kind: "email", busy: false, error: "", rows: null, revision: 0, patch: p => set(p) })), [scope]);
  const s = useLookup();
  useEffect(() => () => { const state = useLookup.getState(); state.patch({ revision: state.revision + 1, value: "", rows: null }); }, [useLookup]);
  const edit = (p: { value?: string; kind?: "email" | "phone" }) => s.patch({ ...p, rows: null, error: "", busy: false, revision: s.revision + 1 });
  const submit = async () => {
    const current = useLookup.getState();
    if (current.busy || !account) return;
    let value = current.value.trim().toLowerCase();
    if (current.kind === "phone") {
      const checked = checkPhone(value);
      if (!checked.ok) { current.patch({ error: checked.message }); return; }
      value = checked.value;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
      current.patch({ error: "Enter the complete email address." }); return;
    }
    const revision = current.revision + 1;
    current.patch({ busy: true, error: "", rows: null, revision });
    const active = () => useLookup.getState().revision === revision &&
      (useAuthStore.getState().user?.authId || String(useAuthStore.getState().user?.id || "")) === account;
    try {
      const result = await ticketsApi.getEventTicketsPaginated(eventId, { pageSize: 200, contactLookup: { kind: current.kind, value } });
      if (!active()) return;
      current.patch({ busy: false, rows: result.tickets, error: result.hasMore ? "More matches exist. Use the guest's ticket code to narrow the lookup." : "" });
    } catch {
      if (active()) current.patch({ busy: false, rows: null, error: "Could not look up this contact. Check your connection and permissions, then try again." });
    }
  };
  return <section className="my-3 rounded-xl border border-white/15 p-3" aria-label="Find ticket by contact">
    <p className="text-sm font-semibold">Find by email or phone</p>
    <p className="mt-1 text-xs text-white/60">Ask the guest for the complete contact used at checkout. Online lookup only; contact details stay hidden.</p>
    <div className="mt-2 flex gap-2">
      <select aria-label="Contact type" value={s.kind} onChange={e => edit({ kind: e.target.value as "email" | "phone" })} className="rounded-lg bg-[#111] px-2 text-white">
        <option value="email">Email</option><option value="phone">Phone</option>
      </select>
      <input aria-label="Complete checkout contact" autoComplete="off" type={s.kind === "email" ? "email" : "tel"} maxLength={254}
        value={s.value} onChange={e => edit({ value: e.target.value })} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
        placeholder={s.kind === "email" ? "Complete email address" : "Phone with country code"} className="min-w-0 flex-1 rounded-lg bg-white/5 px-2 py-3 text-sm" />
      <button type="button" onClick={() => void submit()} disabled={s.busy || !s.value.trim() || !account} className="rounded-lg bg-cyan-500 px-3 text-sm font-semibold text-black disabled:opacity-40">{s.busy ? "Finding…" : "Find"}</button>
    </div>
    {s.error && <p role="alert" className="mt-2 text-sm text-red-300">{s.error}</p>}
    {s.rows && <div aria-live="polite" className="mt-2">
      {s.rows.length === 0 ? <p className="text-sm text-white/60">No matching tickets for this event.</p> : s.rows.map(t => <div key={t.id} className="flex items-center justify-between gap-2 border-t border-white/10 py-2">
        <div><p className="text-sm">{t.holder_name || "Ticket holder"}</p><p className="text-xs text-white/60">{t.ticket_type_name || "Ticket"} · {t.status}</p></div>
        <button type="button" disabled={!hasAdmissionPurpose(t.category) || !isAdmissible(t.status) || t.status === "scanned" || !!checkingInToken || !t.qr_token} onClick={() => { edit({ value: "" }); onCheckIn(t.qr_token); }} className="rounded-lg bg-white/10 px-3 py-2 text-sm disabled:opacity-40">{!hasAdmissionPurpose(t.category) ? "Use service redemption" : checkingInToken === t.qr_token ? "Checking…" : t.status === "scanned" ? "Checked in" : "Check in"}</button>
      </div>)}
      <button type="button" onClick={() => edit({ value: "" })} className="mt-2 text-sm text-white/70">Clear contact lookup</button>
    </div>}
  </section>;
}
