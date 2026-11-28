"use client";
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { ticketsApi, type TicketRecord } from "@dvnt/app/lib/api/tickets";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { checkEmail, normalizeUsername, normalizePhoneE164 } from "@dvnt/app/lib/checkout/profile-fields";
import { hasAdmissionPurpose } from "@dvnt/app/lib/tickets/ticket-category";
import { isAdmissible } from "@dvnt/app/lib/tickets/ticket-access";

type LookupKind = "email" | "phone" | "username";

/** Contact lookup is online, explicit-submit, ephemeral and never roster-cached. */
export function DoorContactLookup({ eventId, onCheckIn, checkingInToken }: {
  eventId: string; onCheckIn?: (token: string) => void; checkingInToken?: string | null;
}) {
  const account = useAuthStore(s => s.user?.authId || String(s.user?.id || ""));
  const scope = `${eventId}:${account}`;
  const useLookup = useMemo(() => create<{
    value: string; kind: LookupKind; busy: boolean; error: string; rows: TicketRecord[] | null; revision: number;
    patch: (p: Partial<{ value: string; kind: LookupKind; busy: boolean; error: string; rows: TicketRecord[] | null; revision: number }>) => void;
  }>(set => ({ value: "", kind: "email", busy: false, error: "", rows: null, revision: 0, patch: p => set(p) })), [scope]);
  const s = useLookup();
  useEffect(() => () => { const state = useLookup.getState(); state.patch({ revision: state.revision + 1, value: "", rows: null }); }, [useLookup]);
  const edit = (p: { value?: string; kind?: LookupKind }) => {
    const current = useLookup.getState();
    current.patch({ ...p, rows: null, error: "", busy: false, revision: current.revision + 1 });
  };
  const submit = async () => {
    const current = useLookup.getState();
    if (current.busy || !account) return;
    let value: string;
    if (current.kind === "phone") {
      const phone = normalizePhoneE164(current.value);
      if (!phone) { current.patch({ error: "Enter the complete phone number. Include the country code outside the US and Canada." }); return; }
      value = phone;
    } else if (current.kind === "username") {
      value = normalizeUsername(current.value);
      // Existing account handles remain findable, including reserved names
      // which are blocked only when creating a new guest checkout label.
      if (!/^[a-z0-9_.]{3,30}$/.test(value) || value.startsWith(".") || value.endsWith(".") || value.includes("..")) {
        current.patch({ error: "Enter the complete username." }); return;
      }
    } else {
      const email = checkEmail(current.value);
      if (!email.ok) { current.patch({ error: "Enter the complete email address." }); return; }
      value = email.value;
    }
    const revision = current.revision + 1;
    current.patch({ busy: true, error: "", rows: null, revision });
    const active = () => useLookup.getState().revision === revision &&
      (useAuthStore.getState().user?.authId || String(useAuthStore.getState().user?.id || "")) === account;
    try {
      const result = await ticketsApi.getEventTicketsPaginated(eventId, { pageSize: 200, contactLookup: { kind: current.kind, value } });
      if (!active()) return;
      current.patch({ busy: false, rows: result.tickets, error: result.hasMore ? "More matches exist. Use the guest's ticket code to narrow the lookup." : "" });
    } catch (err) {
      if (active()) current.patch({ busy: false, rows: null, error:
        typeof err === "object" && err && "status" in err && err.status === 429
          ? "Too many ticket lookups. Try again shortly."
          : "Could not look up this ticket. Check your connection and permissions, then try again." });
    }
  };
  return <section className="my-3 rounded-xl border border-white/15 p-3" aria-label="Find ticket by contact">
    <p className="text-sm font-semibold">Find by username, email, or phone</p>
    <p className="mt-1 text-xs text-white/60">Enter the complete detail for the current ticket holder. Online only; contact details stay hidden.</p>
    <div className="mt-2 flex gap-2">
      <select aria-label="Contact type" value={s.kind} onChange={e => edit({ kind: e.target.value as LookupKind, value: "" })} className="rounded-lg bg-[#111] px-2 text-white">
        <option value="email">Email</option><option value="phone">Phone</option><option value="username">Username</option>
      </select>
      <input aria-label="Complete checkout contact" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        type={s.kind === "email" ? "email" : s.kind === "phone" ? "tel" : "text"} maxLength={254}
        value={s.value} onChange={e => edit({ value: e.target.value })} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
        placeholder={s.kind === "email" ? "Complete email address" : s.kind === "phone" ? "Phone with country code" : "Complete @username"} className="min-w-0 flex-1 rounded-lg bg-white/5 px-2 py-3 text-sm" />
      <button type="button" onClick={() => void submit()} disabled={s.busy || !s.value.trim() || !account} className="rounded-lg bg-cyan-500 px-3 text-sm font-semibold text-black disabled:opacity-40">{s.busy ? "Finding…" : "Find"}</button>
    </div>
    {s.error && <p role="alert" className="mt-2 text-sm text-red-300">{s.error}</p>}
    {s.rows && <div aria-live="polite" className="mt-2">
      {s.rows.length === 0 ? <p className="text-sm text-white/60">No matching tickets for this event.</p> : s.rows.map(t => <div key={t.id} className="flex items-center justify-between gap-2 border-t border-white/10 py-2">
        <div><p className="text-sm">{t.holder_name || "Ticket holder"}</p><p className="text-xs text-white/60">{t.ticket_type_name || "Ticket"} · {t.status}</p></div>
        {onCheckIn ? <button type="button" disabled={!hasAdmissionPurpose(t.category) || !isAdmissible(t.status) || t.status === "scanned" || !!checkingInToken || !t.qr_token} onClick={() => { edit({ value: "" }); onCheckIn(t.qr_token); }} className="rounded-lg bg-white/10 px-3 py-2 text-sm disabled:opacity-40">{!hasAdmissionPurpose(t.category) ? "Use service redemption" : checkingInToken === t.qr_token ? "Checking…" : t.status === "scanned" ? "Checked in" : "Check in"}</button> : null}
      </div>)}
      <button type="button" onClick={() => edit({ value: "" })} className="mt-2 text-sm text-white/70">Clear contact lookup</button>
    </div>}
  </section>;
}
