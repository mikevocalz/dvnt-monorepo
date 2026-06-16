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

    // Sampling
    sampleRate: config.sampleRate ?? 1.0,
    tracesSampleRate: config.tracesSampleRate ?? 0.3,
    profilesSampleRate: config.profilesSampleRate ?? 0.1,

    // Privacy
    beforeSend: createBeforeSend(),
    beforeSendTransaction: createBeforeSendTransaction(),

    // Integrations
    integrations: (defaults: any[]) => {
      return defaults;
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

    // Attach screenshots on crash
    attachScreenshot: true,

    // Attach view hierarchy for debugging
    attachViewHierarchy: true,

    // Enable automatic performance instrumentation
    enableAutoPerformanceTracing: true,

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
