"use client";

/**
 * Settings → Payments (Attendee) — web (port of native
 * `app/settings/payments.tsx`). The native screen is a pure navigation hub: it
 * has NO data hooks/stores — only `useRouter` for navigation. So this port wires
 * the same navigation behavior and reproduces every section + row faithfully.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop is off), sticky
 * header + close X like legal-page.web.tsx, rounded `bg-white/4` cards with rows
 * like notifications.web.tsx. Navigation via `useRouter` from solito/navigation;
 * each row pushes the same route native pushes. Icons via lucide-react (native
 * uses lucide-react-native). No list data, so no TanStack Virtual needed.
 */

import { useRouter } from "solito/navigation";
import {
  X,
  CreditCard,
  Receipt,
  RotateCcw,
  ShoppingBag,
  ChevronRight,
} from "lucide-react";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-white/40">
      {children}
    </p>
  );
}

function SettingsRow({
  icon,
  iconColor,
  label,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-1 py-3.5 text-left border-b border-white/8 last:border-0 active:bg-white/5"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${iconColor}22` }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-white">
          {label}
        </span>
        <span className="mt-0.5 block truncate text-xs text-white/60">
          {subtitle}
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-white/40" />
    </button>
  );
}

export function PaymentsScreen() {
  const router = useRouter();

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Payments</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Payment Methods */}
        <SectionLabel>Payment Methods</SectionLabel>
        <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
          <SettingsRow
            icon={<CreditCard size={20} color="#8A40CF" />}
            iconColor="#8A40CF"
            label="Cards & Banks"
            subtitle="Manage your payment methods"
            onClick={() => router.push("/settings/payment-methods")}
          />
        </div>

        {/* Purchases */}
        <SectionLabel>Purchases</SectionLabel>
        <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
          <SettingsRow
            icon={<ShoppingBag size={20} color="#3B82F6" />}
            iconColor="#3B82F6"
            label="Order History"
            subtitle="View all your purchases"
            onClick={() => router.push("/settings/purchases")}
          />
          <SettingsRow
            icon={<Receipt size={20} color="#22C55E" />}
            iconColor="#22C55E"
            label="Receipts & Invoices"
            subtitle="View, print, and share receipts"
            onClick={() => router.push("/settings/receipts")}
          />
        </div>

        {/* Refunds & Disputes */}
        <SectionLabel>Refunds & Disputes</SectionLabel>
        <div className="rounded-2xl bg-white/4 border border-white/10 px-4">
          <SettingsRow
            icon={<RotateCcw size={20} color="#F97316" />}
            iconColor="#F97316"
            label="Refunds"
            subtitle="Track refund requests and status"
            onClick={() => router.push("/settings/refunds")}
          />
        </div>
      </main>
    </div>
  );
}

export default PaymentsScreen;
