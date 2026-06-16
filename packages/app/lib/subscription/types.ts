/**
 * DVNT subscription domain model — the single source of truth for plan
 * families, plan keys, entitlement keys, and the resolved-entitlement shape.
 *
 * The app asks "what can this user do?" (Entitlements), never "what Stripe
 * price does this user have?". Stripe price IDs live server-side only
 * (apps/mobile/supabase/functions). DB persists `product_family` + `plan_key`
 * + status; the resolver (./entitlements) turns that into Entitlements.
 *
 * iOS compliance: subscriptions are sold via web Stripe checkout only
 * (reader-app pattern). The native app reads entitlements; it does not sell.
 */

/** Two subscription families. A DVNT membership always includes Sneaky Lynk. */
export type ProductFamily = "sneaky_lynk" | "dvnt_membership";

/** Every concrete plan across both families. `free` belongs to both. */
export type PlanKey =
  | "free"
  | "sneaky_tier_1"
  | "sneaky_tier_2"
  | "dvnt_core"
  | "dvnt_insider"
  | "dvnt_vip"
  | "dvnt_founders_circle";

/** Mirrors Stripe subscription.status plus our local fallbacks. */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "inactive";

/** Explicit, reusable entitlement keys (see resolver for how they're filled). */
export type EntitlementKey =
  // Sneaky Lynk
  | "sneaky_lynk_access"
  | "sneaky_lynk_unlimited_duration"
  | "sneaky_lynk_max_participants"
  | "sneaky_lynk_session_minutes"
  | "sneaky_lynk_monthly_host_limit"
  | "sneaky_lynk_face_for_access"
  | "sneaky_lynk_block_accounts"
  | "sneaky_lynk_mute_chat"
  | "sneaky_lynk_monitor_rooms"
  | "sneaky_lynk_event_networking_rooms"
  | "sneaky_lynk_vip_rooms"
  | "sneaky_lynk_recurring_private_groups"
  | "sneaky_lynk_post_event_afterparties"
  | "sneaky_lynk_invite_only_rooms"
  // DVNT membership / events
  | "dvnt_member_badge"
  | "dvnt_priority_rsvp"
  | "dvnt_early_ticket_access"
  | "dvnt_event_allowance"
  | "dvnt_event_allowance_period"
  | "dvnt_any_produced_event_access"
  | "dvnt_vip_admission"
  | "dvnt_expedited_entry"
  | "dvnt_coat_check"
  | "dvnt_partner_event_discounts"
  | "dvnt_quarterly_merch_drops"
  | "dvnt_invite_only_experiences"
  | "dvnt_limited_capacity_priority"
  | "dvnt_featured_member_status"
  | "dvnt_experimental_features";

/** Period over which an event allowance is granted. */
export type AllowancePeriod = "month" | "quarter" | null;

/**
 * The resolved capability set for a user. Numbers use `null` to mean
 * "unlimited" (duration / host sessions / event allowance). This object — not a
 * Stripe price id — is what UI and access-control read.
 */
export interface Entitlements {
  family: ProductFamily;
  planKey: PlanKey;
  /** Sneaky Lynk */
  sneakyLynkAccess: boolean;
  /** null = unlimited duration. */
  sessionMinutes: number | null;
  maxParticipants: number;
  /** null = unlimited host sessions; 0 = cannot host paid rooms. */
  monthlyHostSessions: number | null;
  faceForAccess: boolean;
  blockAccounts: boolean;
  muteChat: boolean;
  monitorRooms: boolean;
  eventNetworkingRooms: boolean;
  vipRooms: boolean;
  recurringPrivateGroups: boolean;
  postEventAfterparties: boolean;
  inviteOnlyRooms: boolean;
  /** Events */
  memberBadge: boolean;
  priorityRsvp: boolean;
  earlyTicketAccess: boolean;
  /** null = any DVNT-produced event (no numeric cap). */
  eventAllowance: number | null;
  eventAllowancePeriod: AllowancePeriod;
  anyProducedEventAccess: boolean;
  vipAdmission: boolean;
  expeditedEntry: boolean;
  coatCheck: boolean;
  partnerEventDiscounts: boolean;
  quarterlyMerchDrops: boolean;
  inviteOnlyExperiences: boolean;
  limitedCapacityPriority: boolean;
  featuredMemberStatus: boolean;
  experimentalFeatures: boolean;
}

/**
 * Persisted subscription row (subset the resolver needs). Mirrors the
 * membership_subscriptions / sneaky_subscriptions tables. Dates are ISO strings.
 */
export interface SubscriptionRecord {
  productFamily: ProductFamily;
  planKey: PlanKey;
  status: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean | null;
  /** Set while a past_due subscription is in its dunning grace window. */
  gracePeriodEndsAt?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
}
