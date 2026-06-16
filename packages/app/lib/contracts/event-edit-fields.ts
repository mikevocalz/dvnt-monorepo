/**
 * Event edit-field registry (prompt Phase 5.5.1) — the SINGLE source of truth for
 * every persisted field across `events`, `ticket_types`, `ticket_addons`(+variants),
 * `event_spotlight_campaigns` (boost), and the flyer object. Create, the edit form,
 * the edit-DTO, and the round-trip test all read THIS list so they cannot drift.
 *
 * Each entry: { field, table, editable_post_publish, propagation, edit_guard? }.
 * `propagation` encodes the Phase-2 mutation→propagation contract (who/what
 * re-renders/re-issues/refunds when this field changes).
 *
 * Grounded in the live schema verified during the tier/add-on/boost/flyer waves
 * (migrations 20260613000000–20260613004000 on `dvnt-social`).
 */

export type EditTable =
  | "events"
  | "ticket_types"
  | "ticket_addons"
  | "ticket_addon_variants"
  | "event_spotlight_campaigns"
  | "flyer";

/** Phase-2 propagation classes (who is notified / what re-renders / re-issues / refunds). */
export type Propagation =
  | "none" // pure metadata, no downstream effect
  | "rerender" // re-render dependent surfaces (feed/event page/wallet/share/scanner)
  | "notify_push" // required push to holders + rerender
  | "notify_refund_window" // required push + opens a refund window per policy
  | "reissue_artifact" // wallet ticket / .ics / OG regenerate
  | "cancel_cascade" // event cancel → tickets REFUNDED, everything → CANCELLED
  | "tier_ui" // tier selector UI only
  | "boost_lifecycle"; // boost pause/refund pro-rata tie-in

export interface EditField {
  field: string;
  table: EditTable;
  editable_post_publish: boolean;
  propagation: Propagation;
  /** Server-side guard enforced on save (must match a DB constraint/trigger). */
  edit_guard?: string;
}

export const EVENT_EDIT_FIELDS: EditField[] = [
  // ── events ──────────────────────────────────────────────────────────────
  { field: "title", table: "events", editable_post_publish: true, propagation: "rerender" },
  { field: "description", table: "events", editable_post_publish: true, propagation: "rerender" },
  { field: "date", table: "events", editable_post_publish: true, propagation: "notify_refund_window" },
  { field: "start_date", table: "events", editable_post_publish: true, propagation: "notify_refund_window" },
  { field: "end_date", table: "events", editable_post_publish: true, propagation: "reissue_artifact" },
  { field: "location", table: "events", editable_post_publish: true, propagation: "notify_refund_window" },
  { field: "category", table: "events", editable_post_publish: true, propagation: "rerender" },
  { field: "visibility", table: "events", editable_post_publish: true, propagation: "rerender" },
  { field: "max_attendees", table: "events", editable_post_publish: true, propagation: "tier_ui",
    edit_guard: "capacity_below_sold (trigger trg_event_capacity_guard)" },
  { field: "status", table: "events", editable_post_publish: true, propagation: "cancel_cascade" },
  { field: "age_restriction", table: "events", editable_post_publish: true, propagation: "none" },
  { field: "youtube_video_url", table: "events", editable_post_publish: true, propagation: "rerender" },
  // ── per-event organizer policy (Phase 5 gaps) ────────────────────────────
  { field: "attendee_name_requirement", table: "events", editable_post_publish: true, propagation: "rerender",
    edit_guard: "in (off|optional|required) — events_attendee_name_req_chk; enforced in issue_guest_rsvp_tickets" },
  { field: "refund_policy", table: "events", editable_post_publish: true, propagation: "rerender",
    edit_guard: "in (none|before_event|days_before|always) — events_refund_policy_chk" },
  { field: "refund_days_before", table: "events", editable_post_publish: true, propagation: "none" },
  { field: "fee_mode", table: "events", editable_post_publish: true, propagation: "tier_ui",
    edit_guard: "in (pass|absorb) — events_fee_mode_chk" },

  // ── flyer object (events columns + meta) ─────────────────────────────────
  { field: "video_flyer_url", table: "flyer", editable_post_publish: true, propagation: "reissue_artifact" },
  { field: "video_poster_url", table: "flyer", editable_post_publish: true, propagation: "reissue_artifact" },
  { field: "flyer_image_url", table: "flyer", editable_post_publish: true, propagation: "reissue_artifact" },
  { field: "cover_image_url", table: "flyer", editable_post_publish: true, propagation: "reissue_artifact" },
  { field: "dominant_color", table: "flyer", editable_post_publish: true, propagation: "rerender" },
  { field: "flyer_image_meta", table: "flyer", editable_post_publish: true, propagation: "rerender" },

  // ── ticket_types (tier model v2) ─────────────────────────────────────────
  { field: "name", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "tier_type", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "price_cents", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "min_price_cents", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "currency", table: "ticket_types", editable_post_publish: false, propagation: "tier_ui" },
  { field: "quantity_total", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui",
    edit_guard: "capacity_below_sold (trigger trg_tier_capacity_guard)" },
  { field: "quantity_reserved_comp", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "max_per_order", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "max_per_user", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "price_schedule", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "sub_allocations", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "sale_start", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "sale_end", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "tier_visibility", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "unlock_code", table: "ticket_types", editable_post_publish: true, propagation: "none" },
  { field: "unlocks_after_tier_id", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "status", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "sort_order", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "perks", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },
  { field: "glow_color", table: "ticket_types", editable_post_publish: true, propagation: "tier_ui" },

  // ── ticket_addons ────────────────────────────────────────────────────────
  { field: "name", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },
  { field: "description", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },
  { field: "addon_type", table: "ticket_addons", editable_post_publish: false, propagation: "rerender" },
  { field: "binding_mode", table: "ticket_addons", editable_post_publish: false, propagation: "rerender" },
  { field: "price_cents", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },
  { field: "min_price_cents", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },
  { field: "quantity_total", table: "ticket_addons", editable_post_publish: true, propagation: "rerender",
    edit_guard: "not below quantity_sold" },
  { field: "requires_tier_id", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },
  { field: "is_redeemable", table: "ticket_addons", editable_post_publish: false, propagation: "none" },
  { field: "image_url", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },
  { field: "sort_order", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },
  { field: "status", table: "ticket_addons", editable_post_publish: true, propagation: "rerender" },

  // ── ticket_addon_variants (size×color matrix) ────────────────────────────
  { field: "name", table: "ticket_addon_variants", editable_post_publish: true, propagation: "rerender" },
  { field: "option_values", table: "ticket_addon_variants", editable_post_publish: false, propagation: "rerender" },
  { field: "price_cents", table: "ticket_addon_variants", editable_post_publish: true, propagation: "rerender" },
  { field: "quantity_total", table: "ticket_addon_variants", editable_post_publish: true, propagation: "rerender",
    edit_guard: "not below quantity_sold" },
  { field: "sku", table: "ticket_addon_variants", editable_post_publish: true, propagation: "none" },
  { field: "sort_order", table: "ticket_addon_variants", editable_post_publish: true, propagation: "rerender" },

  // ── event_spotlight_campaigns (boost) ────────────────────────────────────
  { field: "placement", table: "event_spotlight_campaigns", editable_post_publish: true, propagation: "boost_lifecycle" },
  { field: "amount_cents", table: "event_spotlight_campaigns", editable_post_publish: false, propagation: "boost_lifecycle" },
  { field: "starts_at", table: "event_spotlight_campaigns", editable_post_publish: true, propagation: "boost_lifecycle" },
  { field: "ends_at", table: "event_spotlight_campaigns", editable_post_publish: true, propagation: "boost_lifecycle" },
  { field: "targeting", table: "event_spotlight_campaigns", editable_post_publish: true, propagation: "boost_lifecycle" },
  { field: "status", table: "event_spotlight_campaigns", editable_post_publish: true, propagation: "boost_lifecycle",
    edit_guard: "guard_boost_event_eligible + uniq_active_boost_per_event" },
];

/** Registry-coverage helper: given the field names an edit form renders, returns
 * any registry fields it fails to render (the prompt's "zero unrendered" check). */
export function uncoveredEditFields(renderedFieldKeys: Set<string>): EditField[] {
  return EVENT_EDIT_FIELDS.filter((f) => !renderedFieldKeys.has(`${f.table}.${f.field}`));
}

/** Stable key for a registry entry. */
export const fieldKey = (f: EditField): string => `${f.table}.${f.field}`;
