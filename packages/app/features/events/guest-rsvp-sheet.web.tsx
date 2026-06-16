"use client";
/**
 * GuestRsvpSheet (web) — no-account free-RSVP flow (Phase 5.6.3b). Three steps in
 * a BottomSheet: contact form → OTP code → confirmed. Calls the deployed edge
 * functions (rsvp-verify issue/verify → rsvp-issue-guest). State lives in
 * useGuestRsvpStore (Zustand, no useState).
 */
import { useEffect } from "react";
import { Minus, Plus, Mail, CheckCircle2 } from "lucide-react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useGuestRsvpStore } from "@dvnt/app/lib/stores/guest-rsvp-store";
import { BottomSheet } from "@dvnt/app/components/bottom-sheet.web";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Call an edge function and normalize our { ok, error:{message} } envelope plus
// the non-2xx (rate-limit / invalid-grant) responses.
async function callFn(
  name: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j = await (error as any).context?.json?.();
      if (j?.error?.message) return { ok: false, error: j.error.message };
    } catch {
      /* ignore */
    }
    return { ok: false, error: error.message || "Something went wrong." };
  }
  if (data && data.ok === false)
    return { ok: false, error: data.error?.message || "Request failed." };
  return { ok: true, data };
}

export function GuestRsvpSheet() {
  const s = useGuestRsvpStore();
  const patch = s.patch;
  const open = s.open;
  const eventId = s.eventId;
  // Fetch this event's attendee-name requirement (anon can read public events).
  useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    supabase
      .from("events")
      .select("attendee_name_requirement")
      .eq("id", Number(eventId))
      .single()
      .then(({ data }) => {
        if (!cancelled && data)
          patch({ nameRequirement: data.attendee_name_requirement ?? "off" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, eventId, patch]);

  if (!s.open) return null;

  const collectNames = s.quantity > 1 || s.nameRequirement !== "off";
  const namesRequired = s.nameRequirement === "required";

  const sendCode = async () => {
    const email = s.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      s.patch({ error: "Enter a valid email." });
      return;
    }
    if (namesRequired) {
      for (let i = 0; i < s.quantity; i++) {
        if (!(s.attendeeNames[i] ?? "").trim()) {
          s.patch({ error: "Enter a name for each ticket." });
          return;
        }
      }
    }
    s.patch({ loading: true, error: null });
    const r = await callFn("rsvp-verify", {
      action: "issue",
      event_id: Number(s.eventId),
      channel: "email",
      destination: email,
    });
    s.patch({ loading: false });
    if (!r.ok) {
      s.patch({ error: r.error });
      return;
    }
    s.patch({ step: "code", error: null });
  };

  const confirm = async () => {
    if (!/^\d{6}$/.test(s.code.trim())) {
      s.patch({ error: "Enter the 6-digit code." });
      return;
    }
    s.patch({ loading: true, error: null });
    const v = await callFn("rsvp-verify", {
      action: "verify",
      event_id: Number(s.eventId),
      channel: "email",
      destination: s.email.trim().toLowerCase(),
      code: s.code.trim(),
    });
    if (!v.ok || !v.data?.grant) {
      s.patch({ loading: false, error: v.error || "Incorrect code." });
      return;
    }
    const issue = await callFn("rsvp-issue-guest", {
      grant: v.data.grant,
      event_id: Number(s.eventId),
      quantity: s.quantity,
      guest_name: s.name.trim() || undefined,
      attendee_names: collectNames ? s.attendeeNames.slice(0, s.quantity) : undefined,
    });
    s.patch({ loading: false });
    if (!issue.ok) {
      s.patch({ error: issue.error });
      return;
    }
    s.patch({ step: "done", resultCount: issue.data?.count ?? s.quantity, error: null });
  };

  return (
    <BottomSheet open={s.open} onClose={s.close} title={s.step === "done" ? "" : "RSVP"}>
      {s.step === "form" ? (
        <div className="flex flex-col gap-4">
          <div>
            <div className="font-bold">{s.eventTitle}</div>
            <div className="text-sm text-white/50">
              Free RSVP — we&apos;ll email your ticket{s.quantity > 1 ? "s" : ""}. No account needed.
            </div>
          </div>

          <Field label="Email">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={s.email}
              onChange={(e) => s.patch({ email: e.target.value, error: null })}
              placeholder="you@email.com"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]"
            />
          </Field>
          <Field label="Your name (optional)">
            <input
              value={s.name}
              onChange={(e) => s.patch({ name: e.target.value })}
              placeholder="Name on the door list"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]"
            />
          </Field>

          <div className="flex items-center justify-between">
            <span className="text-sm text-white/70">How many?</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => s.patch({ quantity: Math.max(1, s.quantity - 1) })}
                disabled={s.quantity <= 1}
                aria-label="Fewer"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 disabled:opacity-40"
              >
                <Minus size={16} color="#fff" />
              </button>
              <span className="w-6 text-center font-semibold">{s.quantity}</span>
              <button
                onClick={() => s.patch({ quantity: Math.min(10, s.quantity + 1) })}
                disabled={s.quantity >= 10}
                aria-label="More"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 disabled:opacity-40"
              >
                <Plus size={16} color="#fff" />
              </button>
            </div>
          </div>

          {collectNames ? (
            <Field label={namesRequired ? "Name for each ticket" : "Guest names (optional)"}>
              <div className="flex flex-col gap-2">
                {Array.from({ length: s.quantity }).map((_, i) => (
                  <input
                    key={i}
                    value={s.attendeeNames[i] ?? ""}
                    onChange={(e) => s.setAttendeeName(i, e.target.value)}
                    placeholder={
                      s.quantity > 1 ? `Ticket ${i + 1} of ${s.quantity}` : "Attendee name"
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]"
                  />
                ))}
              </div>
            </Field>
          ) : null}

          {s.error ? <p className="text-sm text-[#FC253A]">{s.error}</p> : null}

          <button
            onClick={sendCode}
            disabled={s.loading}
            className="h-12 w-full rounded-xl bg-linear-to-r from-[#3FDCFF] to-[#8A40CF] font-bold text-white disabled:opacity-50"
          >
            {s.loading ? "Sending…" : "Continue"}
          </button>
        </div>
      ) : s.step === "code" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Mail size={18} color="#3FDCFF" />
            <span className="text-sm text-white/80">
              Enter the 6-digit code we sent to <b className="text-white">{s.email}</b>
            </span>
          </div>
          <input
            inputMode="numeric"
            value={s.code}
            onChange={(e) =>
              s.patch({ code: e.target.value.replace(/\D/g, "").slice(0, 6), error: null })
            }
            placeholder="••••••"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-center text-2xl font-bold tracking-[0.4em] text-white placeholder:text-white/20 outline-none focus:border-[#3FDCFF]"
          />
          {s.error ? <p className="text-sm text-[#FC253A]">{s.error}</p> : null}
          <button
            onClick={confirm}
            disabled={s.loading}
            className="h-12 w-full rounded-xl bg-linear-to-r from-[#3FDCFF] to-[#8A40CF] font-bold text-white disabled:opacity-50"
          >
            {s.loading ? "Confirming…" : "Confirm RSVP"}
          </button>
          <button
            onClick={() => s.patch({ step: "form", code: "", error: null })}
            className="text-sm font-medium text-white/55"
          >
            ← Use a different email
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 size={48} color="#3FDCFF" />
          <h2 className="text-xl font-extrabold">You&apos;re in!</h2>
          <p className="max-w-[300px] text-sm text-white/70">
            {s.resultCount > 1 ? `${s.resultCount} tickets are` : "Your ticket is"} on the way to{" "}
            <b className="text-white">{s.email}</b> — each with its own QR for the door.
          </p>
          <button
            onClick={s.close}
            className="mt-2 h-12 w-full rounded-xl bg-white/10 font-bold text-white"
          >
            Done
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-white/45">{label}</span>
      {children}
    </label>
  );
}
