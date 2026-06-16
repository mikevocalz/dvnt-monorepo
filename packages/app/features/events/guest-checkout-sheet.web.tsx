"use client";
/**
 * GuestCheckoutSheet (web) — no-account PAID ticket purchase (Phase 5.6.3).
 * Collects buyer email/name/qty, calls guest-checkout (which returns a hosted
 * Stripe Checkout Session URL), and redirects the browser there. Card data never
 * touches us; on payment the stripe-webhook issues + emails the ticket(s). State
 * in useGuestCheckoutStore (Zustand, no useState).
 */
import { useEffect } from "react";
import { Minus, Plus, Lock } from "lucide-react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useGuestCheckoutStore } from "@dvnt/app/lib/stores/guest-checkout-store";
import { BottomSheet } from "@dvnt/app/components/bottom-sheet.web";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function GuestCheckoutSheet() {
  const s = useGuestCheckoutStore();
  const patch = s.patch;
  const eventId = s.eventId;
  const open = s.open;
  // Fetch this event's attendee-name requirement (anon can read public events).
  useEffect(() => {
    if (!open || !eventId) return;
    let cancelled = false;
    supabase
      .from("events")
      .select("attendee_name_requirement, refund_policy, refund_days_before")
      .eq("id", Number(eventId))
      .single()
      .then(({ data }) => {
        if (!cancelled && data)
          patch({
            nameRequirement: data.attendee_name_requirement ?? "off",
            refundPolicy: data.refund_policy ?? "before_event",
            refundDaysBefore: data.refund_days_before ?? null,
          });
      });
    return () => {
      cancelled = true;
    };
  }, [open, eventId, patch]);

  if (!s.open) return null;

  const collectNames = s.quantity > 1 || s.nameRequirement !== "off";
  const namesRequired = s.nameRequirement === "required";

  const total = (s.priceCents * s.quantity) / 100;

  const checkout = async () => {
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
    const { data, error } = await supabase.functions.invoke("guest-checkout", {
      body: {
        event_id: Number(s.eventId),
        ticket_type_id: s.tierId,
        quantity: s.quantity,
        guest_email: email,
        guest_name: s.name.trim() || undefined,
        ...(collectNames ? { attendee_names: s.attendeeNames.slice(0, s.quantity) } : {}),
      },
    });
    let url: string | undefined;
    let message = "Could not start checkout.";
    if (error) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j = await (error as any).context?.json?.();
        if (j?.error?.message) message = j.error.message;
      } catch {
        /* ignore */
      }
    } else if (data?.ok && data.url) {
      url = data.url;
    } else if (data?.error?.message) {
      message = data.error.message;
    }
    if (url) {
      // Redirect to Stripe's hosted checkout.
      window.location.href = url;
      return;
    }
    s.patch({ loading: false, error: message });
  };

  return (
    <BottomSheet open={s.open} onClose={s.close} title="Checkout">
      <div className="flex flex-col gap-4">
        <div>
          <div className="font-bold">{s.tierName || "Ticket"}</div>
          <div className="text-sm text-white/50">{s.eventTitle}</div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-white/45">Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={s.email}
            onChange={(e) => s.patch({ email: e.target.value, error: null })}
            placeholder="you@email.com"
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]"
          />
          <span className="text-[11px] text-white/40">We&apos;ll email your ticket here — no account needed.</span>
        </label>

        {!collectNames ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-white/45">Name on ticket (optional)</span>
            <input
              value={s.name}
              onChange={(e) => s.patch({ name: e.target.value })}
              placeholder="Name for the door"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]"
            />
          </label>
        ) : null}

        <div className="flex items-center justify-between">
          <span className="text-sm text-white/70">Quantity</span>
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
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-white/45">
              {namesRequired ? "Name for each ticket" : "Guest names (optional)"}
            </span>
            <div className="flex flex-col gap-2">
              {Array.from({ length: s.quantity }).map((_, i) => (
                <input
                  key={i}
                  value={s.attendeeNames[i] ?? ""}
                  onChange={(e) => s.setAttendeeName(i, e.target.value)}
                  placeholder={`Ticket ${i + 1}${namesRequired ? "" : " (optional)"}`}
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]"
                />
              ))}
            </div>
          </label>
        ) : null}

        <div className="flex items-center justify-between border-t border-white/10 pt-3">
          <span className="text-sm text-white/70">Total</span>
          <span className="font-bold">${total.toFixed(2)}</span>
        </div>

        <p className="text-[11px] text-white/40">
          {refundLabel(s.refundPolicy, s.refundDaysBefore)}
        </p>

        {s.error ? <p className="text-sm text-[#FC253A]">{s.error}</p> : null}

        <button
          onClick={checkout}
          disabled={s.loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-[#3FDCFF] to-[#8A40CF] font-bold text-white disabled:opacity-50"
        >
          <Lock size={16} color="#fff" />
          {s.loading ? "Starting…" : `Pay $${total.toFixed(2)}`}
        </button>
        <p className="text-center text-[11px] text-white/40">
          Secure checkout by Stripe. Already have an account?{" "}
          <span className="text-white/60">Sign in for faster checkout.</span>
        </p>
      </div>
    </BottomSheet>
  );
}

/** Buyer-facing refund-policy line (mirrors ticket-refund enforcement). */
function refundLabel(policy: string, daysBefore: number | null): string {
  switch (policy) {
    case "none":
      return "All sales final — no refunds.";
    case "always":
      return "Refundable anytime before the event.";
    case "days_before":
      return `Refundable up to ${daysBefore ?? 0} day${daysBefore === 1 ? "" : "s"} before the event.`;
    case "before_event":
    default:
      return "Refundable until the event starts.";
  }
}
