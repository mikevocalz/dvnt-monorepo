/**
 * @dvnt/observability — Route & feature context
 *
 * Tags the current route, screen, and feature area on all Sentry events.
 * Call on every route transition.
 */

import type { FeatureArea, SentrySDK } from './types';

let _sentry: SentrySDK | null = null;

export function setSentryInstance(sentry: SentrySDK): void {
  _sentry = sentry;
}

function getSentry(): SentrySDK | null {
  return _sentry;
}

/**
 * Set the current route context. Called on every navigation.
 */
export function setSentryRouteContext(
  route: string,
  screen: string,
  featureArea: FeatureArea,
): void {
  const sentry = getSentry();
  if (!sentry) return;

  sentry.setTags({
    route,
    screen,
    featureArea,
  });

  sentry.setContext('dvnt_navigation', {
    route,
    screen,
    featureArea,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Set auth state tag (authenticated, anonymous, expired).
 */
export function setSentryAuthState(state: 'authenticated' | 'anonymous' | 'expired'): void {
  const sentry = getSentry();
  if (!sentry) return;
  sentry.setTag('authState', state);
}

/**
 * Set network status tag.
 */
export function setSentryNetworkStatus(status: 'online' | 'offline' | 'slow'): void {
  const sentry = getSentry();
  if (!sentry) return;
  sentry.setTag('networkStatus', status);
}

/**
 * Set vite-web specific tags for blog/admin context.
 */
export function setSentryWebContext(ctx: {
  area?: 'blog' | 'admin' | 'dashboard';
  route?: string;
  payloadCollection?: string;
  slug?: string;
  category?: string;
  editorMode?: boolean;
  previewMode?: boolean;
}): void {
  const sentry = getSentry();
  if (!sentry) return;

  const tags: Record<string, string> = {};
  if (ctx.area) tags.area = ctx.area;
  if (ctx.route) tags.route = ctx.route;
  if (ctx.payloadCollection) tags.payloadCollection = ctx.payloadCollection;
  if (ctx.slug) tags.slug = ctx.slug;
  if (ctx.category) tags.category = ctx.category;
  if (ctx.editorMode !== undefined) tags.editorMode = String(ctx.editorMode);
  if (ctx.previewMode !== undefined) tags.previewMode = String(ctx.previewMode);

  sentry.setTags(tags);
}
