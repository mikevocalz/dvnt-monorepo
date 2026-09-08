/**
 * What the drawer offers, and — just as deliberately — what it does not.
 *
 * Every row here resolves to a route that exists in `apps/mobile/app`. Rows the
 * brief asked for that have no destination are recorded in
 * `STRUCK_DESTINATIONS` below with the reason, rather than shipped as menu
 * items that dead-end. A menu that lies about where it goes is worse than a
 * shorter menu.
 */

import type { LibraryCounts } from "./drawer-types.ts";

export type DrawerRowId =
  | "my-tickets"
  | "orders"
  | "sneaky-lynk"
  | "host-dashboard"
  | "membership"
  | "settings"
  | "help";

/** Matches the web rail, which leads every row with a 24pt lucide icon. */
export type DrawerRowIcon =
  | "ticket"
  | "receipt"
  | "lock"
  | "gauge"
  | "crown"
  | "settings"
  | "help";

export interface DrawerRow {
  id: DrawerRowId;
  label: string;
  icon: DrawerRowIcon;
  href: string;
  /** Shown under the label when there is something true to say. */
  detail?: string;
  /** Rendered as a count chip. Absent when zero. */
  badge?: number;
}

export interface DrawerSection {
  id: string;
  /** Section heading. Absent for the leading, unlabelled group. */
  title?: string;
  rows: DrawerRow[];
}

export interface DrawerViewer {
  /** Server-resolved: this account can manage at least one event. */
  canHost: boolean;
}

/**
 * Rows the brief specified that have no destination in this repo. Kept in code
 * so the next person adding one starts from the blocker rather than
 * rediscovering it.
 *
 * - **Saved** — DEFERRED. `bookmarks` is post-only (`bookmarks.post_id`;
 *   `functions/get-bookmarks/index.ts:59-60`) and already renders inside the
 *   Profile tab. Saved *events* are a different read path
 *   (`qk.events.liked`). A "Saved" row covering "events and posts" needs a
 *   merged read path that does not exist; the blocker is that decision, not a
 *   missing screen.
 * - **Scan tickets** — DEFERRED. The scanner is `events/[id]/scanner`, which
 *   needs an event id. A top-level row needs a "which event am I working
 *   tonight" resolver keyed on event-scoped staff roles. Reachable today
 *   through Host dashboard → event.
 * - **Blog / editorial** — DEFERRED. Web-only
 *   (`apps/web/src/app/(frontend)/(marketing)/blog`). No native route, so a
 *   native row would have to open a browser; that is a product call, not a
 *   navigation gap.
 */
export const STRUCK_DESTINATIONS = ["saved", "scan-tickets", "blog"] as const;

export function buildDrawerSections(
  viewer: DrawerViewer,
  counts: LibraryCounts,
): DrawerSection[] {
  const sections: DrawerSection[] = [
    {
      id: "primary",
      rows: [
        {
          id: "my-tickets",
          label: "My Tickets",
          icon: "ticket",
          href: "/(protected)/events/my-tickets",
          // Events and passes are counted separately: "3" alone could mean
          // either, and they are different answers to "how many do I have".
          detail: ticketsDetail(counts),
          badge: counts.needsAttention > 0 ? counts.needsAttention : undefined,
        },
        {
          id: "orders",
          label: "Orders & receipts",
          icon: "receipt",
          href: "/settings/purchases",
        },
        {
          id: "sneaky-lynk",
          label: "Sneaky Lynk",
          icon: "lock",
          href: "/(protected)/sneaky-lynk",
          detail: "Private rooms",
        },
      ],
    },
  ];

  if (viewer.canHost) {
    sections.push({
      id: "hosting",
      title: "Hosting",
      rows: [
        {
          id: "host-dashboard",
          label: "Host dashboard",
          icon: "gauge",
          href: "/(protected)/events/host",
          detail: "Guests, check-in, payouts",
        },
      ],
    });
  }

  sections.push({
    id: "account",
    title: "Account",
    rows: [
      {
        id: "membership",
        label: "Membership",
        icon: "crown",
        href: "/settings/membership",
      },
      {
        id: "settings",
        label: "Settings & privacy",
        icon: "settings",
        href: "/settings",
      },
      { id: "help", label: "Help & support", icon: "help", href: "/settings/faq" },
    ],
  });

  return sections;
}

function ticketsDetail(counts: LibraryCounts): string | undefined {
  if (counts.needsAttention > 0) {
    return counts.needsAttention === 1
      ? "1 needs your attention"
      : `${counts.needsAttention} need your attention`;
  }
  if (counts.upcomingEvents === 0) return undefined;
  const events =
    counts.upcomingEvents === 1 ? "1 event" : `${counts.upcomingEvents} events`;
  const passes =
    counts.upcomingPasses === 1 ? "1 pass" : `${counts.upcomingPasses} passes`;
  return `${events} · ${passes}`;
}

/**
 * Is this row the screen the member is currently on?
 *
 * Mirrors the web rail's rule (`app-shell.web.tsx:65-68`): exact match, or the
 * row is an ancestor of the current path. The one difference is that
 * expo-router's `usePathname()` omits group segments — it reports
 * `/events/my-tickets`, not `/(protected)/events/my-tickets` — so both sides
 * are stripped of `(group)` segments before comparing. Without that, no row
 * ever matched and the rail's selected state simply never appeared on a phone.
 */
export function isDrawerRowActive(pathname: string, href: string): boolean {
  const a = stripGroups(pathname);
  const b = stripGroups(href);
  if (!b || b === "/") return a === "/";
  return a === b || a.startsWith(b + "/");
}

function stripGroups(path: string): string {
  const cleaned = path
    .split("/")
    .filter((segment) => segment && !/^\(.*\)$/.test(segment))
    .join("/");
  return cleaned ? `/${cleaned}` : "/";
}

/**
 * Routes where a horizontal edge-swipe belongs to the screen, not the drawer.
 *
 * Checkout and the scanner because a stray drawer mid-payment or mid-door is a
 * real cost; stories and the camera because the gesture is the content; calls
 * and rooms because a live session must not be interrupted; editors because a
 * swipe there means text selection.
 */
const GESTURE_BLOCKED = [
  "/checkout",
  "/story",
  "/camera",
  "/call",
  "/lynk",
  "/sneaky-lynk/room",
  "/crop-preview",
  "/scanner",
  "/edit-",
  "/events/create",
  "/events/edit",
  "/profile/edit",
  "/chat",
  "/comments",
];

export function drawerGestureEnabled(pathname: string): boolean {
  return !GESTURE_BLOCKED.some((blocked) => pathname.includes(blocked));
}

/**
 * The drawer opens from the app's own top-level surfaces. Anywhere the member
 * pushed to has a back button in that corner, and two meanings for one corner
 * is how people end up somewhere they did not ask for.
 */
export function drawerAvailableOn(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/index" ||
    /^\/\(protected\)\/\(tabs\)(\/(index|events|activity|profile))?$/.test(
      pathname,
    ) ||
    /^\/(events|activity|profile)$/.test(pathname)
  );
}
