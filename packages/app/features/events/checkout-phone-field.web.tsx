"use client";
/**
 * Mobile number for a signed-in buyer whose account has none on file. Shown
 * only after a checkout function answered phone_required; the next checkout
 * sends it and the server stores it privately.
 */
import { useCheckoutPhoneStore } from "@dvnt/app/lib/stores/checkout-phone-store";

const INPUT =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]";
const LABEL = "text-xs font-medium uppercase tracking-wide text-white/45";

export function CheckoutPhoneField() {
  const needed = useCheckoutPhoneStore((s) => s.needed);
  const phone = useCheckoutPhoneStore((s) => s.phone);
  const setPhone = useCheckoutPhoneStore((s) => s.setPhone);
  if (!needed) return null;

  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL}>Mobile number</span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="(212) 555-0142 or +44 7700 900123"
        aria-describedby="checkout-phone-hint"
        className={INPUT}
      />
      <span id="checkout-phone-hint" className="text-[11px] leading-relaxed text-white/45">
        Add a mobile number to finish checkout. It stays private and never shows on your profile.
      </span>
    </label>
  );
}
