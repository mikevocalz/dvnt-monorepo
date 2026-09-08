/**
 * What a member is told after paying.
 *
 * `get-cart-status` already returns the two facts this needs — `cart.status`
 * and the issued `tickets` — and the success screen ignored both, rendering
 * "Tickets Ready" under a green check the moment it mounted. It said the same
 * thing while issuance was still processing and while the cart had been
 * abandoned.
 *
 * Payment and fulfilment are separate. So are "we know this failed" and "we do
 * not yet know" — and the difference between those two is the difference
 * between a member relaxing and a member paying twice.
 */

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
  | { kind: "issued"; admissionCount: number; coatCheckCount: number }
  /** Paid, server says complete, but no credential came back. */
  | { kind: "issued-empty" }
  /** The cart ended without completing. */
  | { kind: "not-completed" }
  /**
   * We could not establish what happened. Never says "you were not charged" —
   * we do not know that.
   */
  | { kind: "unresolved" };

export interface CheckoutTicketLike {
  category?: string | null;
}

/**
 * How long to keep polling before an unanswered cart becomes `unresolved`.
 * Indefinite polling is not a state; it is a screen that never resolves and a
 * member who never learns anything.
 */
export const ISSUANCE_GRACE_MS = 90_000;

export function resolveCheckoutOutcome(input: {
  status: CartStatus | null | undefined;
  tickets: readonly CheckoutTicketLike[] | undefined;
  /** True before the first successful status read. */
  isLoading: boolean;
  /** True when the status read itself failed. */
  isError: boolean;
  /** Milliseconds since the screen started waiting. */
  elapsedMs: number;
}): CheckoutOutcome {
  const tickets = input.tickets ?? [];

  // Credentials in hand outrank everything. If the server issued them, the
  // purchase completed whatever else is in flight.
  if (tickets.length > 0) {
    return {
      kind: "issued",
      admissionCount: tickets.filter((t) => t.category !== "coat_check").length,
      coatCheckCount: tickets.filter((t) => t.category === "coat_check").length,
    };
  }

  if (input.isError) {
    return input.elapsedMs >= ISSUANCE_GRACE_MS
      ? { kind: "unresolved" }
      : { kind: "checking" };
  }

  if (input.isLoading || !input.status) return { kind: "checking" };

  switch (input.status) {
    case "completed":
      // Paid and closed, but nothing came back. Real, and not the member's
      // problem to diagnose.
      return input.elapsedMs >= ISSUANCE_GRACE_MS
        ? { kind: "issued-empty" }
        : { kind: "issuing" };
    case "paying":
      return input.elapsedMs >= ISSUANCE_GRACE_MS
        ? { kind: "unresolved" }
        : { kind: "issuing" };
    case "abandoned":
      return { kind: "not-completed" };
    case "draft":
    case "holding":
      return input.elapsedMs >= ISSUANCE_GRACE_MS
        ? { kind: "unresolved" }
        : { kind: "checking" };
  }
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
      return {
        title: "Tickets ready",
        body: parts.join(" · "),
        tone: "success",
      };
    }
    case "issuing":
      return {
        title: "Payment confirmed",
        body: "We're issuing your tickets. This page updates on its own — you don't need to pay again.",
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
        body: "Your tickets haven't appeared yet. They'll show in My Tickets as soon as they're issued. Contact support if they don't.",
        tone: "attention",
      };
    case "not-completed":
      return {
        title: "Checkout didn't finish",
        body: "This order was not completed. Nothing was issued.",
        tone: "attention",
      };
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
