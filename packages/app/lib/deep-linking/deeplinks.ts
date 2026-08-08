/**
 * Deep link builder — single source of truth for widget/Live Activity surfaces.
 * Uses existing app config: scheme dvnt, domain dvntapp.live.
 * See lib/deep-linking/link-engine.ts and app.config.js for scheme/domains.
 *
 * Widget and native intents MUST use these functions — no hardcoded URLs.
 */

const WEB_BASE = "https://dvntapp.live";

export function eventDeepLink(eventId: string): string {
  return `${WEB_BASE}/e/${eventId}`;
}

export function postDeepLink(postId: string): string {
  return `${WEB_BASE}/p/${postId}`;
}

export function momentDeepLink(postId: string): string {
  return `${WEB_BASE}/p/${postId}`;
}

export function eventsHomeDeepLink(): string {
  return `${WEB_BASE}/events`;
}

export function recapDeepLink(weekStartISO?: string): string {
  if (weekStartISO) {
    return `${WEB_BASE}/recap/week?start=${weekStartISO}`;
  }
  return `${WEB_BASE}/events`;
}

export function eventsCreateDeepLink(): string {
  return `${WEB_BASE}/events/create`;
}

/** Safe fallback when route is unknown — Events Home */
export function fallbackDeepLink(): string {
  return eventsHomeDeepLink();
}
