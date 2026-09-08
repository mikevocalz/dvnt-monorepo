/**
 * How a boost may be paid for, per platform.
 *
 * App Store Review Guideline 3.1.3(g) names this exact product: "buying
 * advertisements to display in the same app (such as sales of 'boosts' for
 * posts in a social media app) must use in-app purchase." The
 * advertising-management exception in the same guideline is granted only to
 * apps that "do not display the advertisements themselves", which DVNT does.
 *
 * So on iOS there is one lawful in-app route, and Stripe is not it. Encoding
 * that here rather than leaving it in a document means the app cannot open a
 * Stripe sheet for a boost on iOS by accident — `resolveBoostPaymentRoute` is
 * the only thing that decides, and it has no branch that returns `stripe` on a
 * store build.
 *
 * See docs/architecture/boost-billing-route.md for the full reasoning and the
 * verbatim guideline text.
 */

export type BoostPaymentRoute =
  /** StoreKit / Play Billing, via RevenueCat. */
  | "iap"
  /** Stripe. Web only. */
  | "stripe"
  /**
   * No purchase path here. The surface may manage an existing boost and must
   * not sell, and — outside the US storefront — must not point at the web
   * purchase either.
   */
  | "unavailable";

export interface BoostPaymentContext {
  platform: "ios" | "android" | "web";
  /**
   * Whether this build sells boosts on mobile at all. `false` selects the
   * web-only posture from the ADR, where the app manages but never sells.
   */
  mobileSalesEnabled: boolean;
  /** The `boost_sales` kill switch. */
  salesOpen: boolean;
  /** RevenueCat is configured and its native module is present. */
  iapAvailable: boolean;
}

export function resolveBoostPaymentRoute(
  context: BoostPaymentContext,
): BoostPaymentRoute {
  if (!context.salesOpen) return "unavailable";

  if (context.platform === "web") return "stripe";

  // Mobile. Stripe is never an option here, whatever the other flags say.
  if (!context.mobileSalesEnabled) return "unavailable";
  if (!context.iapAvailable) return "unavailable";
  return "iap";
}

/**
 * May this surface point the organizer at the web purchase?
 *
 * 3.1.3's opening restricts steering: apps using other purchase methods
 * "cannot, within the app, encourage users to use a purchasing method other
 * than in-app purchase, except for apps on the United States storefront". So
 * "buy this on dvnt.app" is a US-storefront-only affordance without the
 * External Purchase Link Entitlement.
 */
export function mayLinkToWebPurchase(input: {
  platform: "ios" | "android" | "web";
  /** Two-letter storefront country, e.g. "US". */
  storefront: string | null;
  /** StoreKit External Purchase Link Entitlement, if ever granted. */
  hasExternalPurchaseEntitlement?: boolean;
}): boolean {
  if (input.platform === "web") return true;
  if (input.hasExternalPurchaseEntitlement) return true;
  return input.storefront === "US";
}

/**
 * What the organizer is told when no purchase is possible here.
 *
 * Never invents a reason, and never steers where steering is not permitted.
 */
export function boostUnavailableCopy(input: {
  salesOpen: boolean;
  iapAvailable: boolean;
  mayLinkToWeb: boolean;
}): { title: string; detail: string } {
  if (!input.salesOpen) {
    return {
      title: "Boosts are paused",
      detail: "Boosting isn't available right now. Existing boosts keep running.",
    };
  }
  if (!input.iapAvailable) {
    return {
      title: "Boosting isn't available on this device",
      detail: input.mayLinkToWeb
        ? "You can buy a boost for this event on the DVNT website."
        : "You can manage boosts here once one is running.",
    };
  }
  return {
    title: "Boosting isn't available for this event",
    detail: "Check the event's schedule and status, then try again.",
  };
}
