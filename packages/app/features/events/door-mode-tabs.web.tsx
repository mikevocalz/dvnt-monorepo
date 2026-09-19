"use client";

/**
 * DoorModeTabs — the peer mode switch for event door operations.
 *
 * Scan, Sell, and (managers only) Staff are peers at the top of every
 * door-ops surface. Rules from dvnt-payments-ux:
 *  - One tap between modes; a scanner never passes through a revenue
 *    dashboard.
 *  - A capability the user lacks is ABSENT, not disabled with a lock —
 *    `Staff` renders only for roles that may manage staff.
 *  - The tabs live in the sticky header so they stay reachable even when
 *    the camera is denied or still starting.
 */

import { useRouter } from "solito/navigation";
import { ScanLine, Ticket, Users } from "lucide-react";
import {
  canManageStaff,
  type EventRole,
} from "@dvnt/app/lib/events/event-role";

export type DoorMode = "scan" | "sell" | "staff";

export function DoorModeTabs({
  eventId,
  role,
  active,
}: {
  eventId: string;
  role: EventRole;
  active: DoorMode;
}) {
  const router = useRouter();
  const base =
    "flex h-12 min-w-[84px] items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-bold";
  const activeCls = "bg-[#379ED8]/20 text-[#7fd4ff]";
  const idleCls = "text-white/70";

  const tabs: { key: DoorMode; label: string; icon: typeof ScanLine; href: string }[] = [
    { key: "scan", label: "Scan", icon: ScanLine, href: `/feed/events/${eventId}/scanner` },
    { key: "sell", label: "Sell", icon: Ticket, href: `/feed/events/${eventId}/sell` },
  ];
  if (canManageStaff(role)) {
    tabs.push({
      key: "staff",
      label: "Staff",
      icon: Users,
      href: `/feed/events/${eventId}/staff`,
    });
  }

  return (
    <nav
      aria-label="Event door modes"
      className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1"
    >
      {tabs.map(({ key, label, icon: Icon, href }) => (
        <button
          key={key}
          type="button"
          aria-current={key === active ? "page" : undefined}
          onClick={() => {
            if (key !== active) router.push(href);
          }}
          className={`${base} ${key === active ? activeCls : idleCls}`}
        >
          <Icon size={16} aria-hidden /> {label}
        </button>
      ))}
    </nav>
  );
}
