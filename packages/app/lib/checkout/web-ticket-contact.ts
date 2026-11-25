import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { WEB_TICKET_CONTACT_VERSION } from "./profile-fields";

/** An old endpoint sees no tier, event or cart in this probe and cannot issue
 * tickets, hold inventory, or create payment even during a rolling deploy. */
export async function webTicketContactBody(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (typeof document === "undefined") return body;
  const { data, error } = await invokeEdge<{
    webTicketContactVersion?: number;
    data?: { webTicketContactVersion?: number };
  }>(fn, { action: "contact_capability" });
  if (error || (data?.webTicketContactVersion ?? data?.data?.webTicketContactVersion) !== WEB_TICKET_CONTACT_VERSION) {
    throw new Error("Ticket checkout is updating. Refresh the page and try again.");
  }
  return { checkout_contact_version: WEB_TICKET_CONTACT_VERSION, web_ticket_checkout: body };
}

export function requireWebTicketContactAck(response: unknown): void {
  if (typeof document === "undefined") return;
  if ((response as { webTicketContactVersion?: unknown } | null | undefined)?.webTicketContactVersion !==
      WEB_TICKET_CONTACT_VERSION) {
    throw new Error("Could not verify ticket contact. Refresh before retrying.");
  }
}
