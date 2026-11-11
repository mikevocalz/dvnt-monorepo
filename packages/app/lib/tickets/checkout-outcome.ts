/** A checkout can celebrate only a fresh, verified complete usable set.
 * Current credentials and historical purchase units are separate: a transfer,
 * refund or redemption never becomes a new successful checkout. */

/** `carts.status` — `migrations/20260516150000_mixed_cart_checkout.sql:74-75`. */
export type CartStatus =
  | "draft"
  | "holding"
  | "paying"
  | "completed"
  | "abandoned";

export type CheckoutOutcome =
  /** No server answer yet. Says nothing about the money. */
  | { kind: "checking" }
  /** Server confirmed payment; issuance has not finished. */
  | { kind: "issuing" }
  /** Paid and issued. The only state allowed to celebrate. */
  | {
      kind: "issued";
      admissionCount: number;
      coatCheckCount: number;
      /** Units across issued order_addons rows (quantity summed). */
      addonCount: number;
    }
  /** Paid, server says complete, but no credential came back. */
  | { kind: "issued-empty" }
  /** The cart ended without completing. */
  | { kind: "not-completed" }
  /** Fully accounted historical units, not a newly issued usable bundle. */
  | { kind: "history" }
  /** Some units need checking; usable remaining items can still be opened. */
  | { kind: "partial" }
  /**
   * We could not establish what happened. Never says "you were not charged" —
   * we do not know that.
   */
  | { kind: "unresolved" };

export interface CheckoutTicketLike {
  id?: string; cart_line_item_id?: string | null; status?: string | null;
  usable?: boolean; category?: string | null;
}
export interface CheckoutFulfillment {
  state: string; paymentVerified: boolean; complete: boolean;
  expectedTickets: number; expectedAddons: number; usableTickets: number; usableAddons: number;
  historicalTickets: number; historicalAddons: number;
  lines: readonly {lineId:string;kind:string;expected:number;observed:number;usable:number;historical:number}[];
}

/**
 * An issued `order_addons` row as `get-cart-status` returns it. An add-on-only
 * cart (bought from the ticket-upgrade screen by someone who already holds a
 * ticket) issues zero tickets and one or more of these.
 */
export interface CheckoutAddonLike {
  id?: string; cart_line_item_id?: string | null; usable?: boolean;
  quantity: number;
  status?: string | null;
}

/** Current usable add-on units. Consumed/refunded rows remain receipt history. */
export function issuedAddonCount(
  addons: readonly CheckoutAddonLike[] | undefined,
): number {
  return (addons ?? []).reduce(
    (sum, addon) => (addon.usable === true && ["unfulfilled","fulfilled"].includes(addon.status || "") && Number.isSafeInteger(addon.quantity) && addon.quantity > 0 ? sum + addon.quantity : sum),
    0,
  );
}

/**
 * How long to keep polling before an unanswered cart becomes `unresolved`.
 * Indefinite polling is not a state; it is a screen that never resolves and a
 * member who never learns anything.
 */
export const ISSUANCE_GRACE_MS = 90_000;

/** Both the server's exact per-line proof and the returned usable set must agree.
 * Older endpoints without this proof cannot promote a row into a success claim. */
function fullUsableSet(proof: CheckoutFulfillment | undefined, tickets: readonly CheckoutTicketLike[], addons: readonly CheckoutAddonLike[]): boolean {
  if (!proof || proof.state !== "ready" || proof.paymentVerified !== true || proof.complete !== true ||
      proof.historicalTickets !== 0 || proof.historicalAddons !== 0 || !Array.isArray(proof.lines) || !proof.lines.length) return false;
  const ids = new Set<string>(), lines = new Set<string>();
  let expectedTickets = 0, expectedAddons = 0;
  for (const line of proof.lines) {
    if (!line.lineId || lines.has(line.lineId) || !["ticket","addon"].includes(line.kind) ||
        !Number.isSafeInteger(line.expected) || line.expected <= 0 || line.observed !== line.expected ||
        line.usable !== line.expected || line.historical !== 0) return false;
    lines.add(line.lineId);
    if (line.kind === "ticket") {
      expectedTickets += line.expected;
      if (tickets.filter(t => t.cart_line_item_id === line.lineId).length !== line.expected) return false;
    } else {
      expectedAddons += line.expected;
      if (addons.filter(a => a.cart_line_item_id === line.lineId).reduce((sum,a)=>sum+a.quantity,0) !== line.expected) return false;
    }
  }
  for (const ticket of tickets) {
    if (!ticket.id || ids.has(ticket.id) || ticket.usable !== true || ticket.status !== "active" || !lines.has(ticket.cart_line_item_id || "")) return false;
    ids.add(ticket.id);
  }
  for (const addon of addons) {
    if (!addon.id || ids.has(addon.id) || addon.usable !== true || !["unfulfilled","fulfilled"].includes(addon.status || "") ||
        !Number.isSafeInteger(addon.quantity) || addon.quantity <= 0 || !lines.has(addon.cart_line_item_id || "")) return false;
    ids.add(addon.id);
  }
  return expectedTickets === tickets.length && expectedTickets === proof.expectedTickets && expectedTickets === proof.usableTickets &&
    expectedAddons === issuedAddonCount(addons) && expectedAddons === proof.expectedAddons && expectedAddons === proof.usableAddons;
}
export function resolveCheckoutOutcome(input: {
  status: CartStatus | null | undefined;
  tickets: readonly CheckoutTicketLike[] | undefined;
  addons?: readonly CheckoutAddonLike[] | undefined;
  fulfillment?: CheckoutFulfillment;
  isLoading: boolean;
  isError: boolean;
  elapsedMs: number;
}): CheckoutOutcome {
  // Cached rows never outrank a failed/in-flight current status read.
  if (input.isError || input.isLoading || !input.status) return input.elapsedMs >= ISSUANCE_GRACE_MS ? {kind:"unresolved"} : {kind:"checking"};
  const tickets=input.tickets??[],addons=input.addons??[];
  if (input.status === "completed") {
    if (fullUsableSet(input.fulfillment,tickets,addons)) return {kind:"issued",
      admissionCount:tickets.filter(t=>t.category!=="coat_check").length,
      coatCheckCount:tickets.filter(t=>t.category==="coat_check").length,addonCount:issuedAddonCount(addons)};
    if (input.fulfillment?.state === "history" && input.fulfillment.complete === true) return {kind:"history"};
    if (input.fulfillment?.state === "partial") return {kind:"partial"};
    return input.elapsedMs >= ISSUANCE_GRACE_MS ? {kind:"unresolved"} : {kind:"checking"};
  }
  if (input.status === "abandoned") return {kind:"not-completed"};
  return input.elapsedMs >= ISSUANCE_GRACE_MS ? {kind:"unresolved"} : {kind:"checking"};
}

/** Should the screen still be polling? */
export function shouldPollCheckout(outcome: CheckoutOutcome): boolean {
  return outcome.kind === "checking" || outcome.kind === "issuing";
}

export interface CheckoutCopy {
  title: string;
  body: string;
  /** A green check belongs to exactly one outcome. */
  tone: "success" | "working" | "attention";
}

export function checkoutCopy(outcome: CheckoutOutcome): CheckoutCopy {
  switch (outcome.kind) {
    case "issued": {
      const parts: string[] = [];
      if (outcome.admissionCount > 0) {
        parts.push(
          `${outcome.admissionCount} admission${outcome.admissionCount === 1 ? "" : "s"}`,
        );
      }
      if (outcome.coatCheckCount > 0) {
        parts.push(
          `${outcome.coatCheckCount} coat check${outcome.coatCheckCount === 1 ? "" : "s"}`,
        );
      }
      if (outcome.addonCount > 0) {
        parts.push(
          `${outcome.addonCount} add-on${outcome.addonCount === 1 ? "" : "s"}`,
        );
      }
      const hasTickets = outcome.admissionCount + outcome.coatCheckCount > 0;
      return {
        title: hasTickets
          ? "Tickets ready"
          : outcome.addonCount === 1
            ? "Add-on ready"
            : "Add-ons ready",
        body: parts.join(" · "),
        tone: "success",
      };
    }
    case "issuing":
      return {
        title: "Payment confirmed",
        body: "We're finishing your order. This page updates on its own, so you don't need to pay again.",
        tone: "working",
      };
    case "checking":
      return {
        title: "Confirming your payment",
        body: "This takes a few seconds.",
        tone: "working",
      };
    case "issued-empty":
      return {
        title: "Payment confirmed",
        body: "Your order hasn't appeared yet. It will show in My Tickets as soon as it's issued. Contact support if it doesn't.",
        tone: "attention",
      };
    case "not-completed":
      return {
        title: "Checkout didn't finish",
        body: "This checkout is no longer active. Check your order history before making another purchase.",
        tone: "attention",
      };
    case "history":
      return { title: "Order history", body: "This order includes items that were transferred, used, refunded or canceled. Any available items are listed below.", tone: "attention" };
    case "partial":
      return { title: "Some items need checking", body: "Available items are listed below. Please don't pay again. Check My Tickets or contact support for the rest of this order.", tone: "attention" };
    case "unresolved":
      // Deliberately does not say "you were not charged". We do not know that,
      // and guessing wrong sends someone to pay a second time.
      return {
        title: "We're still confirming this order",
        body: "Please don't pay again. Check My Tickets in a few minutes, or contact support with your order reference.",
        tone: "attention",
      };
  }
}
