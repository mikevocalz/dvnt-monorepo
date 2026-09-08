/**
 * Turns selected campaigns into the promoted candidates the feed contract
 * consumes.
 *
 * `buildFeedSlots` takes `promoted` and knows nothing about eligibility,
 * deficits or caps; `selectSessionBoosts` decides those and knows nothing about
 * feed cadence. This is the seam, and keeping it thin is the point — the two
 * halves stay independently testable.
 *
 * Delivery is gated here as well as in the selector, because `boost_delivery`
 * is a kill switch: closing it must stop impressions immediately without
 * touching what has been sold.
 */

import {
  selectSessionBoosts,
  type BoostCampaign,
  type BoostSelectionOptions,
  type BoostViewer,
} from "./boost-selection.ts";
import type { PromotedCandidate } from "@dvnt/app/components/feed/feed-slots";
import { boostDeliveryOpen, type AdKillSwitches } from "./ad-config.ts";

export interface BoostFeedInput<Event> {
  campaigns: readonly BoostCampaign[];
  viewer: BoostViewer;
  options: BoostSelectionOptions;
  switches: AdKillSwitches;
  /** Resolve a campaign's event. Absent = the event is gone; skip it. */
  lookupEvent: (eventId: string) => Event | undefined;
  /**
   * Server-issued, one per served slot. Impressions dedupe against it, so it
   * must not be derived on the client — a token a client can invent is a
   * delivery count a client can inflate.
   */
  issuePlacementToken: (campaign: BoostCampaign) => string;
}

export function promotedCandidatesForFeed<Event>(
  input: BoostFeedInput<Event>,
): PromotedCandidate<Event>[] {
  if (!boostDeliveryOpen(input.switches)) return [];

  const chosen = selectSessionBoosts(
    input.campaigns,
    input.viewer,
    input.options,
  );

  const out: PromotedCandidate<Event>[] = [];
  for (const campaign of chosen) {
    const event = input.lookupEvent(campaign.eventId);
    // A campaign whose event has been deleted, unpublished or hidden from this
    // viewer resolves to nothing. Dropping it is right: the alternative is a
    // promoted slot pointing at a page that will not load.
    if (event === undefined) continue;
    out.push({
      event,
      campaignId: campaign.campaignId,
      placementToken: input.issuePlacementToken(campaign),
    });
  }
  return out;
}
