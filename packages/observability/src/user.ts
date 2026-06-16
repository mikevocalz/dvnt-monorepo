/**
 * @dvnt/observability — User context management
 *
 * Safe Sentry user identification. Attaches role, status, app version,
 * build, OTA update info. Never sends passwords/tokens/payment info.
 */

import type { SentrySDK, SentryUserContext } from './types';

let _sentry: SentrySDK | null = null;

export function setSentryInstance(sentry: SentrySDK): void {
  _sentry = sentry;
}

function getSentry(): SentrySDK | null {
  return _sentry;
}

/**
 * Identify the current user to Sentry after login.
 * Only sends safe metadata — never tokens, emails (unless safe domain), payments.
 */
export function identifySentryUser(user: SentryUserContext): void {
  const sentry = getSentry();
  if (!sentry) return;

  sentry.setUser({
    id: user.id,
    username: user.username,
  });

  // Set user-level tags for filtering
  const tags: Record<string, string> = {};
  if (user.role) tags.userRole = user.role;
  if (user.accountStatus) tags.accountStatus = user.accountStatus;
  if (user.appVersion) tags.appVersion = user.appVersion;
  if (user.buildNumber) tags.buildNumber = user.buildNumber;
  if (user.expoUpdateId) tags.expoUpdateId = user.expoUpdateId;
  if (user.updateChannel) tags.updateChannel = user.updateChannel;
  if (user.platform) tags.platform = user.platform;
  if (user.deviceModel) tags.deviceModel = user.deviceModel;
  if (user.osVersion) tags.osVersion = user.osVersion;

  sentry.setTags(tags);

  // Set structured context for richer debugging
  sentry.setContext('dvnt_user', {
    id: user.id,
    username: user.username ?? null,
    role: user.role ?? null,
    accountStatus: user.accountStatus ?? null,
    appVersion: user.appVersion ?? null,
    buildNumber: user.buildNumber ?? null,
    expoUpdateId: user.expoUpdateId ?? null,
    updateChannel: user.updateChannel ?? null,
    platform: user.platform ?? null,
    deviceModel: user.deviceModel ?? null,
    osVersion: user.osVersion ?? null,
  });
}

/**
 * Clear Sentry user context on logout.
 */
export function clearSentryUser(): void {
  const sentry = getSentry();
  if (!sentry) return;

  sentry.setUser(null);
  sentry.setContext('dvnt_user', null);
}
