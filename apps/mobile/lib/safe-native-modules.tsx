/**
 * Safe native module imports — gracefully degrade when native modules
 * are not available in the current binary.
 *
 * This prevents OTA updates from crashing on older native builds
 * that don't include these modules.
 */
import React from "react";
import { View } from "react-native";

// ── Stripe ──────────────────────────────────────────────────────────
let _StripeProvider: React.ComponentType<any> | null = null;
try {
  _StripeProvider = require("@stripe/stripe-react-native").StripeProvider;
} catch (e) {
  console.warn(
    "[SafeModules] @stripe/stripe-react-native not available in this binary",
  );
}

export const SafeStripeProvider: React.ComponentType<any> = _StripeProvider
  ? _StripeProvider
  : ({ children }: any) => <>{children}</>;

// ── expo-share-intent (lazy — avoid SDK 55 init crash) ─────────────────
type ShareIntentResult = {
  hasShareIntent: boolean;
  shareIntent: any;
  resetShareIntent: () => void;
};

let _useShareIntent: (() => ShareIntentResult) | null = null;
let _shareIntentAttempted = false;

function getUseShareIntent(): (() => ShareIntentResult) | null {
  if (_shareIntentAttempted) return _useShareIntent;
  _shareIntentAttempted = true;
  try {
    _useShareIntent = require("expo-share-intent").useShareIntent;
  } catch (e) {
    console.warn("[SafeModules] expo-share-intent not available:", e);
  }
  return _useShareIntent;
}

const noopShareIntent: ShareIntentResult = {
  hasShareIntent: false,
  shareIntent: null,
  resetShareIntent: () => {},
};

export const useShareIntentSafe: () => ShareIntentResult = () => {
  const useShareIntentImpl = getUseShareIntent();
  return useShareIntentImpl ? useShareIntentImpl() : noopShareIntent;
};

// ── useStripe (also from @stripe/stripe-react-native) ───────────────
let _useStripe: any = null;
try {
  _useStripe = require("@stripe/stripe-react-native").useStripe;
} catch {
  // Already warned above
}

const noopStripe = {
  initPaymentSheet: async () => ({
    error: { message: "Stripe not available" },
  }),
  presentPaymentSheet: async () => ({
    error: { message: "Stripe not available" },
  }),
  confirmPaymentSheetPayment: async () => ({
    error: { message: "Stripe not available" },
  }),
};

export const useStripeSafe = _useStripe ? _useStripe : () => noopStripe;

// ── expo-calendar ───────────────────────────────────────────────────
let _ExpoCalendar: any = null;
try {
  _ExpoCalendar = require("expo-calendar");
} catch {
  console.warn("[SafeModules] expo-calendar not available in this binary");
}

export const SafeCalendar = _ExpoCalendar;

// ── expo-print ──────────────────────────────────────────────────────
let _ExpoPrint: any = null;
try {
  _ExpoPrint = require("expo-print");
} catch {
  console.warn("[SafeModules] expo-print not available in this binary");
}

export const SafePrint = _ExpoPrint;

// ── @callstack/liquid-glass ────────────────────────────────────────

let _LiquidGlassView: React.ComponentType<any> | null = null;
let _LiquidGlassContainerView: React.ComponentType<any> | null = null;
let _isLiquidGlassSupported = false;

try {
  const lg = require("@callstack/liquid-glass");
  _LiquidGlassView = lg.LiquidGlassView;
  _LiquidGlassContainerView = lg.LiquidGlassContainerView;
  _isLiquidGlassSupported = lg.isLiquidGlassSupported;
} catch {
  console.warn(
    "[SafeModules] @callstack/liquid-glass not available in this binary",
  );
}

export const SafeLiquidGlassView: React.ComponentType<any> =
  _LiquidGlassView ?? View;
export const SafeLiquidGlassContainerView: React.ComponentType<any> =
  _LiquidGlassContainerView ?? View;
export const safeIsLiquidGlassSupported = _isLiquidGlassSupported;

// ── react-native-wgpu ───────────────────────────────────────────────
// NOTE: Cannot use require() here because Metro will try to resolve the native
// components even inside try/catch. The entire WeatherGPU feature must be
// conditionally imported at the app level instead.
export const SafeWebGPUModule: any = null;
export const SafeWGPUCanvas: React.ComponentType<any> = View;

// ── react-native-animated-glow ─────────────────────────────────────
let _AnimatedGlow: React.ComponentType<any> | null = null;

try {
  _AnimatedGlow = require("react-native-animated-glow").default;
} catch {
  console.warn(
    "[SafeModules] react-native-animated-glow not available in this binary",
  );
}

export const SafeAnimatedGlow: React.ComponentType<any> = _AnimatedGlow ?? View;
