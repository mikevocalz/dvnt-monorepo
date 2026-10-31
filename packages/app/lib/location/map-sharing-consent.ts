import { coarseMapPoint, mapGrantActive, type LocationAccessSnapshot } from "./location-access.ts";

export type ConsentPoint = { latitude: number; longitude: number; timestamp: number };
export function freshConsentPoint(point: ConsentPoint, now = Date.now()) {
  if (!Number.isFinite(point.timestamp) || now - point.timestamp > 60_000 || point.timestamp > now + 5_000) {
    throw new Error("Your location was not fresh enough. Please try sharing again.");
  }
  return { ...coarseMapPoint(point.latitude, point.longitude), observedAt: new Date(point.timestamp).toISOString() };
}

/** Bounds native providers too; late callbacks never become successful samples. */
export function consentTimeout<T>(work: Promise<T>, ms = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Location took too long. You are not sharing. Please try again.")), ms);
    work.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** All writes are supplied by the authenticated, serialized caller. No grant is
 * cached until the initial publication succeeds. Compensation removes a grant
 * if publishing fails or the disclosure is dismissed during an in-flight write. */
export async function commitMapConsent(deps: {
  allowed: () => boolean;
  sameOwner: () => boolean;
  point: ConsentPoint;
  settings: () => Promise<LocationAccessSnapshot>;
  enable: (revision: number) => Promise<LocationAccessSnapshot>;
  publish: (settings: LocationAccessSnapshot, point: ReturnType<typeof freshConsentPoint>) => Promise<unknown>;
  revoke: () => Promise<unknown>;
  withdrawalFailed: () => void;
  committed?: (settings: LocationAccessSnapshot) => void;
}) {
  const assertCurrent = () => { if (!deps.allowed()) throw new Error("Sharing was cancelled. Please try again from the map."); };
  assertCurrent();
  const fresh = await deps.settings();
  assertCurrent();
  // Polling/repeated clicks must never extend an existing four-hour session.
  if (mapGrantActive(fresh, Date.now())) throw new Error("You already have an active sharing session. Reload the map to see it.");
  freshConsentPoint(deps.point);
  let attempted = false;
  try {
    assertCurrent();
    attempted = true;
    const settings = await deps.enable(fresh.revision);
    assertCurrent();
    if (!mapGrantActive(settings, Date.now())) throw new Error("The server did not confirm map sharing. Please try again.");
    await deps.publish(settings, freshConsentPoint(deps.point));
    assertCurrent();
    deps.committed?.(settings);
    return settings;
  } catch (error) {
    if (attempted && deps.sameOwner()) {
      try { await deps.revoke(); }
      catch { deps.withdrawalFailed(); throw new Error("Could not confirm that sharing stopped. Your device has stopped updating. Use Stop sharing to retry."); }
    } else if (attempted) {
      // The old account's token is no longer available. Persist its negative
      // intent so returning to that account cannot silently resume this grant.
      deps.withdrawalFailed();
    }
    throw error;
  }
}
