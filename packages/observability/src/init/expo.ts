/**
 * @dvnt/observability — Expo (React Native) Sentry initialization
 *
 * Call this in apps/mobile app/_layout.tsx BEFORE any other code runs.
 * Configures Sentry with:
 *   - Performance monitoring
 *   - Release/OTA tagging
 *   - beforeSend redaction
 *   - Navigation integration ready
 *   - Hermes profiling
 */

import { createBeforeSend, createBeforeSendTransaction } from '../sanitize';
import { initObservability } from '../index';
import { setReleaseInfo, buildReleaseString } from '../release';
import type { ReleaseInfo } from '../types';

export interface ExpoSentryConfig {
  dsn: string;
  environment: string;
  appVersion: string;
  buildNumber: string;
  runtimeVersion?: string;
  expoUpdateId?: string;
  updateChannel?: string;
  releaseChannel?: string;
  platform: 'ios' | 'android';
  /** Set to false in development */
  enabled?: boolean;
  /** Sample rate for errors (0-1). Default: 1.0 */
  sampleRate?: number;
  /** Sample rate for performance traces (0-1). Default: 0.3 */
  tracesSampleRate?: number;
  /** Sample rate for profiles (0-1). Default: 0.1 */
  profilesSampleRate?: number;
  /** Enable session replay. Default: false */
  replaysEnabled?: boolean;
  /** Extra integrations appended to the SDK defaults (router, replay, feedback). */
  integrations?: unknown[];
  /** Dynamic sampler — wins over tracesSampleRate when provided. */
  tracesSampler?: (ctx: { name?: string }) => number;
  /** Hosts that receive sentry-trace/baggage headers for stitched traces. */
  tracePropagationTargets?: (string | RegExp)[];
}

/**
 * Initialize Sentry for the Expo mobile app.
 *
 * Usage in _layout.tsx:
 * ```ts
 * import * as Sentry from '@sentry/react-native';
 * import { initExpoSentry } from '@dvnt/observability/init/expo';
 *
 * initExpoSentry(Sentry, {
 *   dsn: process.env.EXPO_PUBLIC_SENTRY_DSN!,
 *   environment: __DEV__ ? 'development' : 'production',
 *   appVersion: Constants.expoConfig?.version ?? '1.0.0',
 *   buildNumber: Constants.expoConfig?.ios?.buildNumber ?? '1',
 *   runtimeVersion: Updates.runtimeVersion,
 *   expoUpdateId: Updates.updateId,
 *   updateChannel: Updates.channel,
 *   platform: Platform.OS as 'ios' | 'android',
 * });
 * ```
 */
export function initExpoSentry(Sentry: any, config: ExpoSentryConfig): void {
  const release = buildReleaseString('com.dvnt.app', config.appVersion, config.buildNumber);

  Sentry.init({
    dsn: config.dsn,
    enabled: config.enabled ?? true,
    environment: config.environment,
    release,
    dist: config.buildNumber,

    // Sampling — tracesSampler (dynamic, per-flow boost) wins when provided.
    sampleRate: config.sampleRate ?? 1.0,
    ...(config.tracesSampler
      ? { tracesSampler: config.tracesSampler }
      : { tracesSampleRate: config.tracesSampleRate ?? 0.3 }),
    profilesSampleRate: config.profilesSampleRate ?? 0.1,
    ...(config.tracePropagationTargets
      ? { tracePropagationTargets: config.tracePropagationTargets }
      : {}),

    // Privacy
    beforeSend: createBeforeSend(),
    beforeSendTransaction: createBeforeSendTransaction(),

    // Integrations — SDK defaults plus caller-provided (router, replay, …).
    integrations: (defaults: any[]) => {
      return [...defaults, ...((config.integrations as any[]) ?? [])];
    },

    // Tags set on every event
    initialScope: {
      tags: {
        app: 'dvnt',
        package: 'expo-app',
        platform: config.platform,
        appVersion: config.appVersion,
        buildNumber: config.buildNumber,
        ...(config.expoUpdateId ? { expoUpdateId: config.expoUpdateId } : {}),
        ...(config.updateChannel ? { updateChannel: config.updateChannel } : {}),
        ...(config.releaseChannel ? { releaseChannel: config.releaseChannel } : {}),
        ...(config.runtimeVersion ? { runtimeVersion: config.runtimeVersion } : {}),
      },
    },

    // Don't send in development
    enableInExpoDevelopment: false,

    // §2.4: screenshots are NOT masked by the RN SDK — a crash frame can
    // contain DMs or profile content, so they never leave the device.
    attachScreenshot: false,

    // Attach view hierarchy for debugging (structure only, no pixels/text)
    attachViewHierarchy: true,

    // Enable automatic performance instrumentation
    enableAutoPerformanceTracing: true,

    // ANR / app-hang detection (native watchdogs)
    enableAppHangTracking: true,

    // Taps become spans — dead-tap patterns show up in traces.
    enableUserInteractionTracing: true,

    // Enable Hermes symbolication
    enableHermes: true,
  });

  // Wire up the observability layer
  initObservability(Sentry);

  // Set release info for all subsequent events
  const releaseInfo: ReleaseInfo = {
    appVersion: config.appVersion,
    buildNumber: config.buildNumber,
    runtimeVersion: config.runtimeVersion,
    expoUpdateId: config.expoUpdateId,
    updateChannel: config.updateChannel,
    releaseChannel: config.releaseChannel,
    environment: config.environment,
    platform: config.platform,
  };
  setReleaseInfo(releaseInfo);
}
