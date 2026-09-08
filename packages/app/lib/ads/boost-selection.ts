/**
 * Which boosted events a viewer sees, and in what order.
 *
 * The rule this replaces is `events-list.web.tsx:148-155`: a stable sort with
 * promoted first. That is permanent pinning — the campaign that happens to be
 * promoted wins every slot on every screen for its whole run, and a second
 * campaign in the same city never displaces it. It is the one ordering the
 * brief's §5 forbids outright, along with `priority DESC` as a sole rule,
 * highest-price-first, and client-side random.
 *
 * What replaces it: equal weight among equivalent eligible campaigns, adjusted
 * by DELIVERY DEFICIT, so a campaign that has been served less catches up. A
 * seven-day package buys time, not weight.
 *
 * Pure and RN-free so it can run on the server, in a test, and in a
 * simulation. The server stays authoritative — this is the algorithm, and the
 * real selector runs where the counts live.
 */

export interface BoostCampaign {
  campaignId: number;
  eventId: string;
  organizerId: string;
  /** ms epoch. */
  startsAt: number;
  endsAt: number;
  /** Payment verified AND creative approved AND event still eligible. */
  activatable: boolean;
  /** Cities/areas this campaign targets. Empty = untargeted. */
  targetCities?: readonly string[];
  /**
   * Opportunities where this campaign was eligible but another was served.
   * The deficit input — NOT a price or a priority.
   */
  eligibleOpportunities: number;
  /** Times actually served. */
  servedImpressions: number;
}

export interface BoostViewer {
  /** Stable per-session, so a session sees a coherent rotation. */
  sessionSeed: number;
  city?: string | null;
  /** Events this viewer already holds a ticket or RSVP for. */
  ticketedEventIds?: readonly string[];
  /** Organizers this viewer blocked, hid, or reported. */
  suppressedOrganizerIds?: readonly string[];
  /** Events already shown to this viewer in this session. */
  seenEventIdsThisSession?: readonly string[];
  /** Campaigns served to this account today, across platforms. */
  servedCampaignIdsToday?: readonly number[];
}

export interface BoostSelectionOptions {
  now: number;
  /** Per-account cross-platform daily cap. */
  dailyCapPerCampaign?: number;
  /** Share of one session's promoted slots any single organizer may take. */
  maxOrganizerShare?: number;
  /** Promoted slots this session will offer, for the diversity cap. */
  sessionSlots?: number;
}

const DEFAULTS = {
  dailyCapPerCampaign: 3,
  maxOrganizerShare: 0.5,
  sessionSlots: 4,
};

export type IneligibleReason =
  | "not-activatable"
  | "outside-window"
  | "city-mismatch"
  | "viewer-has-ticket"
  | "organizer-suppressed"
  | "seen-this-session"
  | "daily-cap";

/**
 * Why a campaign is not a candidate. Returned rather than silently dropped so
 * "my boost never shows" has an answer.
 */
export function ineligibleReason(
  campaign: BoostCampaign,
  viewer: BoostViewer,
  options: BoostSelectionOptions,
): IneligibleReason | null {
  const dailyCap = options.dailyCapPerCampaign ?? DEFAULTS.dailyCapPerCampaign;

  if (!campaign.activatable) return "not-activatable";
  if (options.now < campaign.startsAt || options.now > campaign.endsAt) {
    return "outside-window";
  }
  if (
    campaign.targetCities?.length &&
    (!viewer.city || !campaign.targetCities.includes(viewer.city))
  ) {
    return "city-mismatch";
  }
  // Acquisition: someone already going does not need to be sold a ticket.
  if (viewer.ticketedEventIds?.includes(campaign.eventId)) {
    return "viewer-has-ticket";
  }
  if (viewer.suppressedOrganizerIds?.includes(campaign.organizerId)) {
    return "organizer-suppressed";
  }
  if (viewer.seenEventIdsThisSession?.includes(campaign.eventId)) {
    return "seen-this-session";
  }
  const servedToday = (viewer.servedCampaignIdsToday ?? []).filter(
    (id) => id === campaign.campaignId,
  ).length;
  if (servedToday >= dailyCap) return "daily-cap";

  return null;
}

/**
 * How far behind a campaign is: the share of its eligible opportunities it has
 * NOT been served. A campaign nobody has seen sits at 1; one served every time
 * it was eligible sits at 0.
 */
export function deliveryDeficit(campaign: BoostCampaign): number {
  if (campaign.eligibleOpportunities <= 0) return 1;
  const rate = campaign.servedImpressions / campaign.eligibleOpportunities;
  return Math.max(0, Math.min(1, 1 - rate));
}

/**
 * Deterministic per-session jitter. Two campaigns with the same deficit must
 * still resolve in a fixed order for a given session — otherwise the same
 * viewer re-rendering the feed reshuffles it — but that order has to differ
 * BETWEEN sessions or the same campaign wins the tie forever.
 */
function tieBreak(campaignId: number, sessionSeed: number): number {
  let h = (campaignId * 2654435761) ^ (sessionSeed * 40503);
  h = (h ^ (h >>> 13)) >>> 0;
  h = (Math.imul(h, 1274126177) ^ (h >>> 16)) >>> 0;
  return h / 0xffffffff;
}

export interface RankedBoost {
  campaign: BoostCampaign;
  deficit: number;
}

/**
 * Eligible campaigns, best-first.
 *
 * Order is deficit descending, then the per-session tie-break. Price, priority
 * and recency are deliberately absent: none of them is a fairness signal, and
 * §5 forbids all three.
 */
export function rankEligibleBoosts(
  campaigns: readonly BoostCampaign[],
  viewer: BoostViewer,
  options: BoostSelectionOptions,
): RankedBoost[] {
  return campaigns
    .filter((c) => ineligibleReason(c, viewer, options) === null)
    .map((campaign) => ({ campaign, deficit: deliveryDeficit(campaign) }))
    .sort((a, b) => {
      if (b.deficit !== a.deficit) return b.deficit - a.deficit;
      return (
        tieBreak(a.campaign.campaignId, viewer.sessionSeed) -
        tieBreak(b.campaign.campaignId, viewer.sessionSeed)
      );
    });
}

/**
 * The campaigns to serve across one session's promoted slots.
 *
 * Applies the organizer-diversity cap as it fills: an organizer with five
 * events cannot take five consecutive slots while other organizers qualify.
 * The cap yields only when nobody else is left — an empty slot helps no one.
 */
export function selectSessionBoosts(
  campaigns: readonly BoostCampaign[],
  viewer: BoostViewer,
  options: BoostSelectionOptions,
): BoostCampaign[] {
  const slots = options.sessionSlots ?? DEFAULTS.sessionSlots;
  const maxShare = options.maxOrganizerShare ?? DEFAULTS.maxOrganizerShare;
  const perOrganizerCap = Math.max(1, Math.floor(slots * maxShare));

  const ranked = rankEligibleBoosts(campaigns, viewer, options);
  const chosen: BoostCampaign[] = [];
  const usedByOrganizer = new Map<string, number>();
  const usedEvents = new Set<string>();

  // First pass respects the diversity cap.
  for (const { campaign } of ranked) {
    if (chosen.length >= slots) break;
    if (usedEvents.has(campaign.eventId)) continue;
    const used = usedByOrganizer.get(campaign.organizerId) ?? 0;
    if (used >= perOrganizerCap) continue;
    chosen.push(campaign);
    usedEvents.add(campaign.eventId);
    usedByOrganizer.set(campaign.organizerId, used + 1);
  }

  // Second pass fills what is left rather than leaving a slot empty, since an
  // unfilled promoted slot becomes an organic event and helps no organizer.
  if (chosen.length < slots) {
    for (const { campaign } of ranked) {
      if (chosen.length >= slots) break;
      if (usedEvents.has(campaign.eventId)) continue;
      chosen.push(campaign);
      usedEvents.add(campaign.eventId);
    }
  }

  return chosen;
}

/**
 * Can another campaign be sold for this audience and window?
 *
 * Estimated opportunities divided by the delivery every active campaign is
 * owed. Refusing the sale is the honest answer — the alternative is taking the
 * money and then relaxing caps to make room, which is the same as not having
 * caps.
 */
export function hasCapacityForAnotherCampaign(input: {
  estimatedOpportunities: number;
  activeCampaigns: number;
  /** Impressions a campaign is expected to receive to count as delivered. */
  opportunitiesPerCampaign: number;
  /** Headroom multiplier; below 1 leaves slack. */
  safetyFactor?: number;
}): boolean {
  const safety = input.safetyFactor ?? 0.8;
  if (input.opportunitiesPerCampaign <= 0) return false;
  const supportable = Math.floor(
    (input.estimatedOpportunities * safety) / input.opportunitiesPerCampaign,
  );
  return input.activeCampaigns + 1 <= supportable;
}
