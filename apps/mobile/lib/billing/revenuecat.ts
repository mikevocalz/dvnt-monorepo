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
//        read path and it goes through the DB.
//
// We `require()` the native module lazily so a dev/expo-go build without the
// linked native pod doesn't crash the JS bundle. Matches the existing
// `lib/safe-native-modules.tsx` pattern.

import { Platform } from "react-native";

type PurchasesModule = {
  configure(opts: { apiKey: string; appUserID?: string | null }): void;
  logIn(appUserID: string): Promise<unknown>;
  logOut(): Promise<unknown>;
};

let _Purchases: PurchasesModule | null = null;
let _configured = false;

function getPurchases(): PurchasesModule | null {
  if (_Purchases) return _Purchases;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-purchases");
    _Purchases = (mod?.default ?? mod) as PurchasesModule;
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
