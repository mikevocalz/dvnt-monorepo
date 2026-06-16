/**
 * @dvnt/observability — Release & OTA health tracking
 *
 * Helpers to attach release/build/OTA metadata to every Sentry event.
 * Separates native build version from OTA update versioning.
 */

import type { ReleaseInfo, SentrySDK } from './types';

let _sentry: SentrySDK | null = null;
let _releaseInfo: ReleaseInfo | null = null;

export function setSentryInstance(sentry: SentrySDK): void {
  _sentry = sentry;
}

function getSentry(): SentrySDK | null {
  return _sentry;
}

/**
 * Set the release info once at app startup.
 * This tags every subsequent Sentry event with version/build/OTA data.
 */
export function setReleaseInfo(info: ReleaseInfo): void {
  _releaseInfo = info;

  const sentry = getSentry();
  if (!sentry) return;

  sentry.setTags({
    appVersion: info.appVersion,
    buildNumber: info.buildNumber,
    platform: info.platform,
    environment: info.environment,
    ...(info.runtimeVersion ? { runtimeVersion: info.runtimeVersion } : {}),
    ...(info.expoUpdateId ? { expoUpdateId: info.expoUpdateId } : {}),
    ...(info.updateChannel ? { updateChannel: info.updateChannel } : {}),
    ...(info.releaseChannel ? { releaseChannel: info.releaseChannel } : {}),
  });

  sentry.setContext('dvnt_release', {
    appVersion: info.appVersion,
    buildNumber: info.buildNumber,
    runtimeVersion: info.runtimeVersion ?? null,
    expoUpdateId: info.expoUpdateId ?? null,
    updateChannel: info.updateChannel ?? null,
    releaseChannel: info.releaseChannel ?? null,
    environment: info.environment,
    platform: info.platform,
  });
}

/**
 * Get the current release info (for reading from other modules).
 */
export function getReleaseInfo(): ReleaseInfo | null {
  return _releaseInfo;
}

/**
 * Update OTA info after an update is applied (without restart).
 * Call this when expo-updates detects a new update.
 */
export function updateOTAInfo(updateId: string, channel?: string): void {
  if (_releaseInfo) {
    _releaseInfo.expoUpdateId = updateId;
    if (channel) _releaseInfo.updateChannel = channel;
  }

  const sentry = getSentry();
  if (!sentry) return;

  sentry.setTag('expoUpdateId', updateId);
  if (channel) sentry.setTag('updateChannel', channel);

  sentry.setContext('dvnt_release', {
    ...(_releaseInfo ?? {}),
    expoUpdateId: updateId,
    updateChannel: channel ?? _releaseInfo?.updateChannel ?? null,
  });
}

/**
 * Build a Sentry release string in the standard format.
 * Format: com.dvnt.app@1.0.0+42
 */
export function buildReleaseString(bundleId: string, version: string, buildNumber: string): string {
  return `${bundleId}@${version}+${buildNumber}`;
}
