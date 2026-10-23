import { subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";

/** Guards asynchronous cache work against a newer attendee-privacy decision. */
const revisions = new Map<string, number>();
let sequence = 0;
let sessionRevision = 0;

// Also discard callbacks from a prior viewer, including A -> B -> A.
subscribeSessionLifecycle(() => {
  sessionRevision = ++sequence;
  revisions.clear();
});

export function getEventAttendanceRevision(eventId: string): number {
  return revisions.get(eventId) ?? sessionRevision;
}
export function advanceEventAttendanceRevision(eventId: string): number {
  const next = ++sequence;
  revisions.set(eventId, next);
  return next;
}
