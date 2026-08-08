// lib/billing/revenuecat.ts — thin RevenueCat lifecycle for the mobile rail.
//
// Failure mode defended against: I1 + I3.
//   I1 — a webhook that arrives with `app_user_id = $RCAnonymousID:*` has no
//        canonical owner; `revenuecat-webhook` refuses to provision. The mobile
//        client MUST call `loginRC(user.id)` at sign-in so every subsequent
//        purchase event carries `app_user_id ≡ user.id`. We log the result so
//        a misconfigured boot is visible in the build before it ships.
//   I3 — entitlement state is read from Supabase (`is_entitled` /
//        `useEntitlements`), NOT from `Purchases.getCustomerInfo()`. This file
//        deliberately does not export an entitlement read — there's only ONE
//        read path and it goes through the DB. That includes the purchase
//        surface below: `purchaseMembershipPackage` / `restoreMembershipPurchases`
//        return ok/cancelled/error ONLY — never CustomerInfo entitlements. After
//        a successful purchase the entitlement row lands via the RC webhook
//        (`revenuecat-webhook` → membership_subscriptions); the UI invalidates
//        the entitlements query and shows a short "activating…" state until the
//        DB row appears.
//
// We `require()` the native module lazily so a dev/expo-go build without the
// linked native pod doesn't crash the JS bundle. Matches the existing
// `lib/safe-native-modules.tsx` pattern.

import { Platform } from "react-native";

// ── Minimal structural types, mirroring the installed react-native-purchases
// typings (dist/offerings.d.ts, @revenuecat/purchases-typescript-internal
// dist/errors.d.ts). We keep a local contract instead of importing the SDK
// types so this file stays consistent with the lazy-require pattern above.

/** Subset of PurchasesStoreProduct we consume. */
export type RCStoreProduct = {
  /** Store product id — iOS `dvnt_core`, Android `dvnt_core:monthly`. */
  identifier: string;
  title: string;
  /** Price in the local currency (numeric). */
  price: number;
  /** Formatted price including currency sign — the display string. */
  priceString: string;
};

/** Subset of PurchasesPackage we consume. */
export type RCPackage = {
  /** RC package id within the offering (`core`, `insider`, `vip`, …). */
  identifier: string;
  product: RCStoreProduct;
};

type RCOffering = {
  identifier: string;
  availablePackages: RCPackage[];
};

type RCOfferings = {
  all: Record<string, RCOffering>;
  current: RCOffering | null;
};

/** Mirrors StoreProductChangeInfo (Play/Galaxy tier change — proration). */
type RCStoreProductChangeInfo = {
  oldProductIdentifier: string;
};

/** Mirrors PurchasesError: code + message + deprecated-but-set userCancelled. */
type RCPurchasesError = {
  code?: string | number;
  message?: string;
  userCancelled?: boolean | null;
};

type PurchasesModule = {
  configure(opts: { apiKey: string; appUserID?: string | null }): void;
  logIn(appUserID: string): Promise<unknown>;
  logOut(): Promise<unknown>;
  getOfferings(): Promise<RCOfferings>;
  purchasePackage(
    aPackage: RCPackage,
    upgradeInfo?: null,
    productChangeInfo?: RCStoreProductChangeInfo | null,
  ): Promise<unknown>;
  restorePurchases(): Promise<unknown>;
};

let _Purchases: PurchasesModule | null = null;
/** PURCHASE_CANCELLED_ERROR from the module's PURCHASES_ERROR_CODE enum. */
let _cancelledCode: string | null = null;
let _configured = false;

function getPurchases(): PurchasesModule | null {
  if (_Purchases) return _Purchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-purchases");
    _Purchases = (mod?.default ?? mod) as PurchasesModule;
    _cancelledCode =
      (mod?.PURCHASES_ERROR_CODE?.PURCHASE_CANCELLED_ERROR as
        | string
        | undefined) ?? null;
    return _Purchases;
  } catch {
    return null;
  }
}

function getApiKey(): string | null {
  if (Platform.OS === "ios") {
    return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? null;
  }
  if (Platform.OS === "android") {
    return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? null;
  }
  return null;
}

/** Idempotent — safe to call from anywhere. No-op without an API key or the
 *  native module (web / expo-go / missing env). */
export function configureRevenueCat(initialUserId: string | null = null): void {
  if (_configured) return;
  const Purchases = getPurchases();
  if (!Purchases) return;
  const apiKey = getApiKey();
  if (!apiKey) return;
  try {
    Purchases.configure({ apiKey, appUserID: initialUserId });
    _configured = true;
  } catch (err) {
    console.warn("[revenuecat] configure failed", err);
  }
}

/** Bind the RC app_user_id to the DVNT user_id. MUST be called at sign-in
 *  (and any time the user id changes) so the RC webhook's `app_user_id` field
 *  resolves directly to a DVNT user without a bridge table. */
export async function loginRC(userId: string): Promise<void> {
  const Purchases = getPurchases();
  if (!Purchases) return;
  if (!_configured) configureRevenueCat(userId);
  if (!_configured) return; // configure failed (no key / no module) — no-op.
  try {
    await Purchases.logIn(userId);
  } catch (err) {
    console.warn("[revenuecat] logIn failed", err);
  }
}

/** Detach the RC identity on logout so the next sign-in on this device
 *  doesn't accidentally inherit the previous user's RC state. */
export async function logoutRC(): Promise<void> {
  const Purchases = getPurchases();
  if (!Purchases || !_configured) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    console.warn("[revenuecat] logOut failed", err);
  }
}

// ── Purchase surface (WS-1 — the mobile rail actually sells) ──────────────
//
// I3 discipline: none of these read or return entitlement state. A purchase's
// effect on "what can this user do?" arrives exclusively via
// revenuecat-webhook → membership_subscriptions → useEntitlements.

function errorMessage(err: unknown): string {
  const e = err as RCPurchasesError;
  return e?.message || "Purchase failed. Please try again.";
}

function isUserCancelled(err: unknown): boolean {
  const e = err as RCPurchasesError;
  if (e?.userCancelled === true) return true;
  return (
    _cancelledCode != null &&
    e?.code != null &&
    String(e.code) === String(_cancelledCode)
  );
}

/** Fetch the current offering's packages (offering lookup_key `default`:
 *  `core` / `insider` / `vip` / `founders_circle`). Returns [] when RC is
 *  unavailable (web / expo-go / missing key) so the paywall can fall back to
 *  read-only tier cards. */
export async function getMembershipPackages(): Promise<RCPackage[]> {
  const Purchases = getPurchases();
  if (!Purchases) return [];
  if (!_configured) configureRevenueCat();
  if (!_configured) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch (err) {
    console.warn("[revenuecat] getOfferings failed", err);
    return [];
  }
}

export type PurchaseResult = {
  ok: boolean;
  /** True when the user dismissed the store sheet — not an error. */
  userCancelled?: boolean;
  error?: string;
};

/** Run the store purchase for a membership package. On Android tier changes,
 *  pass the currently-owned base product id (`dvnt_core`, no `:monthly`
 *  suffix) so Play treats it as a plan change with proration instead of a
 *  duplicate parallel subscription; iOS handles upgrades via the subscription
 *  group automatically. */
export async function purchaseMembershipPackage(
  pkg: RCPackage,
  opts?: { googleOldProductId?: string | null },
): Promise<PurchaseResult> {
  const Purchases = getPurchases();
  if (!Purchases || !_configured) {
    return { ok: false, error: "Purchases are unavailable in this build." };
  }
  try {
    const changeInfo =
      Platform.OS === "android" && opts?.googleOldProductId
        ? { oldProductIdentifier: opts.googleOldProductId }
        : null;
    // MakePurchaseResult (customerInfo et al.) is deliberately discarded — I3.
    await Purchases.purchasePackage(pkg, null, changeInfo);
    return { ok: true };
  } catch (err) {
    if (isUserCancelled(err)) return { ok: false, userCancelled: true };
    console.warn("[revenuecat] purchasePackage failed", err);
    return { ok: false, error: errorMessage(err) };
  }
}

/** Re-sync store receipts with RevenueCat (Apple-required affordance). The
 *  resulting entitlement change, if any, still arrives via the RC webhook →
 *  DB → useEntitlements — callers should invalidate that query after this
 *  resolves. */
export async function restoreMembershipPurchases(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const Purchases = getPurchases();
  if (!Purchases || !_configured) {
    return { ok: false, error: "Purchases are unavailable in this build." };
  }
  try {
    // CustomerInfo is deliberately discarded — I3.
    await Purchases.restorePurchases();
    return { ok: true };
  } catch (err) {
    console.warn("[revenuecat] restorePurchases failed", err);
    return { ok: false, error: errorMessage(err) };
  }
}
