/**
 * Native billing seam for the membership paywall.
 *
 * The RevenueCat SDK wrapper lives in apps/mobile (`lib/billing/revenuecat.ts`)
 * because react-native-purchases is an apps/mobile dependency and packages/app
 * never imports across the app boundary. The native /settings/membership route
 * file in apps/mobile injects an object satisfying this contract; the screen
 * renders read-only tier cards when it is absent (web, expo-go, dev builds
 * without the pod).
 *
 * I3: nothing in this contract exposes entitlement state — purchase calls
 * return ok/cancelled/error only. Entitlements come from Supabase via
 * useEntitlements after the RC webhook writes the row.
 */

/** Structural subset of RevenueCat's PurchasesPackage the paywall consumes. */
export interface RCPackageLike {
  /** RC package id within the offering (`core`, `insider`, `vip`, …). */
  identifier: string;
  product: {
    /** Store product id — iOS `dvnt_core`, Android `dvnt_core:monthly`. */
    identifier: string;
    title: string;
    price: number;
    /** Formatted price including currency sign — the display string. */
    priceString: string;
  };
}

export interface MembershipPurchaseResult {
  ok: boolean;
  /** True when the user dismissed the store sheet — not an error. */
  userCancelled?: boolean;
  error?: string;
}

/**
 * Why a paywall has no packages to sell.
 *
 * Mirrors `OfferingsUnavailableReason` in apps/mobile/lib/billing/revenuecat.ts
 * — packages/app never imports across the app boundary, so the contract is
 * restated here exactly as `RCPackageLike` is. Keep the two in lockstep.
 */
export type OfferingsUnavailableReason =
  | "no_native_module"
  | "not_configured"
  | "no_offering_configured"
  | "store_unreachable";

export type OfferingsResultLike =
  | { status: "ok"; packages: RCPackageLike[] }
  | {
      status: "unavailable";
      reason: OfferingsUnavailableReason;
      detail?: string;
    };

/**
 * Copy for a DISABLED cta. A priced card with no button reads as half-built;
 * a priced card with a disabled button that says why reads as honest.
 */
export function offeringsUnavailableCopy(
  reason: OfferingsUnavailableReason,
): string {
  switch (reason) {
    case "no_native_module":
      return "Not available in this build";
    case "not_configured":
      return "Purchases unavailable";
    case "no_offering_configured":
      return "Not available right now";
    case "store_unreachable":
      return "Can't reach the App Store";
  }
}

export interface MembershipBilling {
  getMembershipPackages(): Promise<RCPackageLike[]>;
  /** Reason-preserving variant. Optional so existing adapters keep compiling;
   *  when absent the UI degrades to a generic unavailable state. */
  getMembershipOfferings?(): Promise<OfferingsResultLike>;
  purchaseMembershipPackage(
    pkg: RCPackageLike,
    opts?: { googleOldProductId?: string | null },
  ): Promise<MembershipPurchaseResult>;
  restoreMembershipPurchases(): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Same seam for the standalone Sneaky Lynk tiers (offering lookup_key
 * `sneaky`, NOT the current offering). Purchase/restore are the same
 * RC calls as the membership paywall — `purchaseMembershipPackage` works
 * for any package — only catalog fetch differs. Injected by the
 * apps/mobile route files that mount SneakySubscriptionModal natively.
 */
export interface SneakyBilling {
  getSneakyPackages(): Promise<RCPackageLike[]>;
  /** Reason-preserving variant — see MembershipBilling. */
  getSneakyOfferings?(): Promise<OfferingsResultLike>;
  purchaseMembershipPackage(
    pkg: RCPackageLike,
    opts?: { googleOldProductId?: string | null },
  ): Promise<MembershipPurchaseResult>;
  restoreMembershipPurchases(): Promise<{ ok: boolean; error?: string }>;
}
