/**
 * Host-facing copy for the event visibility picker.
 *
 * One source of truth so the native and web create/edit screens cannot drift.
 * Every helper string answers the same three questions in the same order:
 * who can find it, who can open it, and how someone gets in.
 *
 * Accuracy rule: describe only mechanisms that exist today. There is no
 * guest-list feature. Access to a private event comes from a comped ticket or
 * from being a co-organizer, so that is what the copy says.
 */

export type EventVisibility = "public" | "private" | "link_only";

export interface EventVisibilityCopy {
  value: EventVisibility;
  /** Button label. */
  label: string;
  /** One clause for dense rows and summaries. */
  summary: string;
  /** Helper text shown under the picker for the selected option. */
  helper: string;
}

export const EVENT_VISIBILITY_COPY: Record<
  EventVisibility,
  EventVisibilityCopy
> = {
  public: {
    value: "public",
    label: "Public",
    summary: "Listed in search and the feed",
    helper:
      "Listed in search and the feed. Anyone can open it and buy a ticket.",
  },
  link_only: {
    value: "link_only",
    label: "Link only",
    summary: "Unlisted, but the link works for anyone",
    helper:
      "Not listed in search or the feed. Anyone holding the link can open it and buy a ticket, including anyone they forward it to.",
  },
  private: {
    value: "private",
    label: "Private",
    summary: "Unlisted, and the link alone is not enough",
    helper:
      "Not listed anywhere, and the link alone will not open it. People get in when you comp them a ticket or add them as a co-organizer.",
  },
};

/** Open to closed. Ordering the picker this way makes the tradeoff readable. */
export const EVENT_VISIBILITY_ORDER: readonly EventVisibility[] = [
  "public",
  "link_only",
  "private",
];

/**
 * Mirrors `normalizeVisibility` in `packages/app/lib/api/events.ts`: the legacy
 * `"unlisted"` string and any unknown value resolve the same way here as they
 * do when an event row is read.
 */
export function resolveEventVisibility(value: unknown): EventVisibility {
  if (value === "public" || value === "private" || value === "link_only") {
    return value;
  }
  if (value === "unlisted") return "link_only";
  return "public";
}

export function eventVisibilityCopy(value: unknown): EventVisibilityCopy {
  return EVENT_VISIBILITY_COPY[resolveEventVisibility(value)];
}

/** Ordered list for rendering a picker. */
export const EVENT_VISIBILITY_OPTIONS: readonly EventVisibilityCopy[] =
  EVENT_VISIBILITY_ORDER.map((v) => EVENT_VISIBILITY_COPY[v]);
