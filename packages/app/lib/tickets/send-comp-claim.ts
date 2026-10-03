/**
 * Native: hand one claim link to the host's own Messages composer.
 *
 * DVNT sends nothing. expo-sms opens the system composer addressed to one
 * number with the text filled in; the host taps send from their own phone.
 * A device that cannot send SMS (an iPad, a simulator) gets the share sheet
 * instead, with the phone in the title so the host knows who it is for.
 *
 * Web uses send-comp-claim.web.ts.
 */
import * as SMS from "expo-sms";
import { shareUrl } from "@dvnt/app/lib/deep-linking/share-link";
import type { CompClaimLink } from "@dvnt/app/lib/api/privileged";
import { statusFromSmsResult, type ClaimSendStatus } from "./comp-claim-message";

/** Each composer resolves when the host closes it, so a queue can wait on it. */
export const canTextAll = true;

export async function textClaimLink(link: CompClaimLink, message: string): Promise<ClaimSendStatus> {
  try {
    if (await SMS.isAvailableAsync()) {
      // One address per composer, always: the link is single use.
      const { result } = await SMS.sendSMSAsync([link.phone], message);
      return statusFromSmsResult(result);
    }
    return await shareClaimLink(link, message);
  } catch (err) {
    console.error("[comp-claim] composer failed:", (err as Error)?.name || "error");
    return "failed";
  }
}

export async function shareClaimLink(link: CompClaimLink, message: string): Promise<ClaimSendStatus> {
  const shared = await shareUrl(link.url, { title: `Ticket for ${link.recipient}`, message });
  return shared === "shared" ? "shared" : shared === "dismissed" ? "cancelled" : "failed";
}
