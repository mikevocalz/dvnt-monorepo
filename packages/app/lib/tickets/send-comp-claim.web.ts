/**
 * Web: open the device's SMS app through an `sms:` URL, one recipient per
 * link. Phones and Macs with Messages handle it; elsewhere the host uses
 * "Share" or copies the link. The browser cannot tell whether the text was
 * sent, so the best this can report is "opened".
 */
import { shareUrl } from "@dvnt/app/lib/deep-linking/share-link";
import type { CompClaimLink } from "@dvnt/app/lib/api/privileged";
import { smsHref, type ClaimSendStatus } from "./comp-claim-message";

/**
 * No "Text all" on web. An sms: URL returns immediately, so a loop would
 * throw every composer at the host at once. One tap per person instead.
 */
export const canTextAll = false;

export async function textClaimLink(link: CompClaimLink, message: string): Promise<ClaimSendStatus> {
  try {
    window.location.assign(smsHref(link.phone, message));
    return "opened";
  } catch {
    return shareClaimLink(link, message);
  }
}

export async function shareClaimLink(link: CompClaimLink, message: string): Promise<ClaimSendStatus> {
  const shared = await shareUrl(link.url, { title: `Ticket for ${link.recipient}`, message });
  return shared === "shared" ? "shared" : shared === "dismissed" ? "cancelled" : "failed";
}
