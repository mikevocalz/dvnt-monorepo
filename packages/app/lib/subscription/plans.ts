/**
 * Plan catalog — prices, marketing copy, and the raw entitlement values for
 * every plan. This is the ONE place plan facts live; UI, the resolver, and
 * (mirrored) the server read from here. Stripe price ids are NOT here — the
 * server maps planKey → price via env (see SUBSCRIPTION_PRICE_ENV below).
 */
import type {
  Entitlements,
  PlanKey,
  ProductFamily,
} from "./types";

/** Per-plan entitlement values (everything except family/planKey). */
type PlanEntitlements = Omit<Entitlements, "family" | "planKey">;

export interface PlanDef {
  key: PlanKey;
  family: ProductFamily;
  name: string;
  /** Price in cents, billed monthly. */
  priceCents: number;
  positioning?: string;
  /** Highlight as the recommended / "Most Popular" plan (VIP, per product). */
  recommended?: boolean;
  /** Name of the server-side env var holding this plan's Stripe price id. */
  stripePriceEnv?: string;
  /** Short marketing bullets for the paywall UI. */
  bullets: { sneaky: string[]; events: string[] };
  entitlements: PlanEntitlements;
}

/** Baseline (free) capabilities, spread+overridden by paid plans below. */
const FREE_ENTITLEMENTS: PlanEntitlements = {
  sneakyLynkAccess: true,
  sessionMinutes: 5,
  maxParticipants: 5,
  // null = no monthly *count* cap. Free hosting is gated by duration (5 min) and
  // participants (5), not by a session count. Only Core (3) / Insider (5) cap
  // the number of hosted sessions per month.
  monthlyHostSessions: null,
  faceForAccess: false,
  blockAccounts: false,
  muteChat: false,
  monitorRooms: false,
  eventNetworkingRooms: false,
  vipRooms: false,
  recurringPrivateGroups: false,
  postEventAfterparties: false,
  inviteOnlyRooms: false,
  memberBadge: false,
  priorityRsvp: false,
  earlyTicketAccess: false,
  eventAllowance: 0,
  eventAllowancePeriod: null,
  anyProducedEventAccess: false,
  vipAdmission: false,
  expeditedEntry: false,
  coatCheck: false,
  partnerEventDiscounts: false,
  quarterlyMerchDrops: false,
  inviteOnlyExperiences: false,
  limitedCapacityPriority: false,
  featuredMemberStatus: false,
  experimentalFeatures: false,
};

/** Paid Sneaky-Lynk host controls shared by tier 1/2 and membership Core+. */
const PAID_HOST_CONTROLS = {
  faceForAccess: true,
  blockAccounts: true,
  muteChat: true,
  monitorRooms: true,
} as const;

export const PLANS: Record<PlanKey, PlanDef> = {
  free: {
    key: "free",
    family: "dvnt_membership",
    name: "Free",
    priceCents: 0,
    positioning: "Get a feel for the room.",
    bullets: {
      sneaky: ["5-minute sessions", "Up to 5 people per link", "Basic access"],
      events: ["RSVP to free events", "Buy tickets at standard pricing"],
    },
    entitlements: { ...FREE_ENTITLEMENTS },
  },

  // ── Standalone Sneaky Lynk family ──
  sneaky_tier_1: {
    key: "sneaky_tier_1",
    family: "sneaky_lynk",
    name: "Sneaky Tier 1",
    priceCents: 999,
    positioning: "Unlimited, small rooms.",
    stripePriceEnv: "STRIPE_PRICE_SNEAKY_TIER_1",
    bullets: {
      sneaky: [
        "Unlimited session duration",
        "Up to 10 people per link",
        "Host controls included",
      ],
      events: [],
    },
    entitlements: {
      ...FREE_ENTITLEMENTS,
      ...PAID_HOST_CONTROLS,
      sessionMinutes: null,
      maxParticipants: 10,
      monthlyHostSessions: null,
    },
  },
  sneaky_tier_2: {
    key: "sneaky_tier_2",
    family: "sneaky_lynk",
    name: "Sneaky Tier 2",
    priceCents: 1499,
    positioning: "Unlimited, big rooms.",
    stripePriceEnv: "STRIPE_PRICE_SNEAKY_TIER_2",
    bullets: {
      sneaky: [
        "Unlimited session duration",
        "Up to 50 people per link",
        "Host controls included",
      ],
      events: [],
    },
    entitlements: {
      ...FREE_ENTITLEMENTS,
      ...PAID_HOST_CONTROLS,
      sessionMinutes: null,
      maxParticipants: 50,
      monthlyHostSessions: null,
    },
  },

  // ── DVNT Membership family (includes Sneaky Lynk) ──
  dvnt_core: {
    key: "dvnt_core",
    family: "dvnt_membership",
    name: "Core",
    priceCents: 2500,
    positioning: "Become a member.",
    stripePriceEnv: "STRIPE_PRICE_DVNT_CORE",
    bullets: {
      sneaky: [
        "Host up to 3 sessions / month",
        "Up to 10 people per link",
        "Face For Access, Block, Mute controls",
      ],
      events: ["1 DVNT event / quarter", "Priority RSVP", "Member badge"],
    },
    entitlements: {
      ...FREE_ENTITLEMENTS,
      faceForAccess: true,
      blockAccounts: true,
      muteChat: true,
      sessionMinutes: null,
      maxParticipants: 10,
      monthlyHostSessions: 3,
      memberBadge: true,
      priorityRsvp: true,
      eventAllowance: 1,
      eventAllowancePeriod: "quarter",
    },
  },
  dvnt_insider: {
    key: "dvnt_insider",
    family: "dvnt_membership",
    name: "Insider",
    priceCents: 5000,
    positioning: "Level up your connections.",
    stripePriceEnv: "STRIPE_PRICE_DVNT_INSIDER",
    bullets: {
      sneaky: [
        "All Core features",
        "Host up to 5 sessions / month",
        "Up to 20 people per link",
        "Event-specific networking rooms",
      ],
      events: ["1 DVNT event / month", "Priority RSVP", "Early ticket access"],
    },
    entitlements: {
      ...FREE_ENTITLEMENTS,
      ...PAID_HOST_CONTROLS,
      sessionMinutes: null,
      maxParticipants: 20,
      monthlyHostSessions: 5,
      eventNetworkingRooms: true,
      memberBadge: true,
      priorityRsvp: true,
      earlyTicketAccess: true,
      eventAllowance: 1,
      eventAllowancePeriod: "month",
    },
  },
  dvnt_vip: {
    key: "dvnt_vip",
    family: "dvnt_membership",
    name: "VIP",
    priceCents: 7500,
    positioning: "All access to DVNT Events.",
    recommended: true, // "Most Popular" per product requirement
    stripePriceEnv: "STRIPE_PRICE_DVNT_VIP",
    bullets: {
      sneaky: [
        "Unlimited hosting sessions",
        "Up to 50 people per link",
        "VIP-only & recurring private rooms",
        "Post-event digital after-parties",
      ],
      events: [
        "Any DVNT-produced event",
        "VIP admission + expedited entry",
        "Coat check included",
      ],
    },
    entitlements: {
      ...FREE_ENTITLEMENTS,
      ...PAID_HOST_CONTROLS,
      sessionMinutes: null,
      maxParticipants: 50,
      monthlyHostSessions: null,
      eventNetworkingRooms: true,
      vipRooms: true,
      recurringPrivateGroups: true,
      postEventAfterparties: true,
      memberBadge: true,
      priorityRsvp: true,
      earlyTicketAccess: true,
      eventAllowance: null,
      eventAllowancePeriod: null,
      anyProducedEventAccess: true,
      vipAdmission: true,
      expeditedEntry: true,
      coatCheck: true,
    },
  },
  dvnt_founders_circle: {
    key: "dvnt_founders_circle",
    family: "dvnt_membership",
    name: "Founders Circle",
    priceCents: 15000,
    positioning: "The ultimate level of access.",
    stripePriceEnv: "STRIPE_PRICE_DVNT_FOUNDERS",
    bullets: {
      sneaky: [
        "Unlimited hosting sessions",
        "Exclusive invite-only rooms",
        "Early access to experimental features",
        "Featured Member status",
      ],
      events: [
        "Any DVNT-produced event + VIP perks",
        "Partner event discounts",
        "Quarterly merch drops & invite-only experiences",
      ],
    },
    entitlements: {
      ...FREE_ENTITLEMENTS,
      ...PAID_HOST_CONTROLS,
      sessionMinutes: null,
      maxParticipants: 50,
      monthlyHostSessions: null,
      eventNetworkingRooms: true,
      vipRooms: true,
      recurringPrivateGroups: true,
      postEventAfterparties: true,
      inviteOnlyRooms: true,
      memberBadge: true,
      priorityRsvp: true,
      earlyTicketAccess: true,
      eventAllowance: null,
      eventAllowancePeriod: null,
      anyProducedEventAccess: true,
      vipAdmission: true,
      expeditedEntry: true,
      coatCheck: true,
      partnerEventDiscounts: true,
      quarterlyMerchDrops: true,
      inviteOnlyExperiences: true,
      limitedCapacityPriority: true,
      featuredMemberStatus: true,
      experimentalFeatures: true,
    },
  },
};

/** Ordered for UI columns. */
export const SNEAKY_PLAN_KEYS: PlanKey[] = ["free", "sneaky_tier_1", "sneaky_tier_2"];
export const MEMBERSHIP_PLAN_KEYS: PlanKey[] = [
  "free",
  "dvnt_core",
  "dvnt_insider",
  "dvnt_vip",
  "dvnt_founders_circle",
];

/** Tier rank for upgrade/downgrade comparisons within a family. */
export const PLAN_RANK: Record<PlanKey, number> = {
  free: 0,
  sneaky_tier_1: 1,
  sneaky_tier_2: 2,
  dvnt_core: 3,
  dvnt_insider: 4,
  dvnt_vip: 5,
  dvnt_founders_circle: 6,
};

/** Map of planKey → the env var the server reads for its Stripe price id. */
export const SUBSCRIPTION_PRICE_ENV: Partial<Record<PlanKey, string>> =
  Object.fromEntries(
    Object.values(PLANS)
      .filter((p) => p.stripePriceEnv)
      .map((p) => [p.key, p.stripePriceEnv as string]),
  );

export function getPlan(key: PlanKey): PlanDef {
  return PLANS[key];
}
