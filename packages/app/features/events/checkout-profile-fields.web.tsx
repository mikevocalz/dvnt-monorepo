"use client";
/**
 * Username, full name and mobile number for signed-out checkout and RSVP.
 * Reads and writes useCheckoutProfileStore; the parent sheet owns email,
 * submission and the error line. `onEdit` lets the parent clear its error.
 */
import { AtSign, Check } from "lucide-react";
import { useCheckoutProfileStore } from "@dvnt/app/lib/stores/checkout-profile-store";

const INPUT =
  "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-[#3FDCFF]";
const LABEL = "text-xs font-medium uppercase tracking-wide text-white/45";

export function CheckoutProfileFields({ onEdit }: { onEdit?: () => void }) {
  const profile = useCheckoutProfileStore();
  const check = profile.usernameCheck;
  const bad = check.status === "taken" || check.status === "invalid";

  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Username</span>
        <div className="relative">
          <AtSign
            size={14}
            color="rgba(255,255,255,0.35)"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            value={profile.username}
            onChange={(e) => {
              profile.setUsername(e.target.value);
              onEdit?.();
            }}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={31}
            placeholder="yourname"
            aria-invalid={bad}
            aria-describedby="checkout-username-status"
            className={`${INPUT} pl-8 pr-9`}
          />
          {check.status === "available" ? (
            <Check
              size={16}
              color="#3FDCFF"
              aria-hidden
              className="absolute right-3 top-1/2 -translate-y-1/2"
            />
          ) : null}
        </div>
        <span
          id="checkout-username-status"
          aria-live="polite"
          className={`text-[11px] ${bad ? "text-[#FC253A]" : "text-white/40"}`}
        >
          {check.status === "checking"
            ? "Checking…"
            : check.message ?? "Letters, numbers, _ and . only."}
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Full name</span>
        <input
          value={profile.fullName}
          onChange={(e) => {
            profile.setFullName(e.target.value);
            onEdit?.();
          }}
          autoComplete="name"
          maxLength={120}
          placeholder="First and last name"
          className={INPUT}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Mobile number</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={profile.phone}
          onChange={(e) => {
            profile.setPhone(e.target.value);
            onEdit?.();
          }}
          placeholder="(212) 555-0142 or +44 7700 900123"
          className={INPUT}
        />
      </label>

      <p className="text-[11px] leading-relaxed text-white/45">
        We use these to set up your DVNT profile so your tickets live in one place. Your name
        and number stay private and never show on your profile.
      </p>
    </>
  );
}
