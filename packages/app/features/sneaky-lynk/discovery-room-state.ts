/** A database `open` row is not evidence of a live room or permission to resume it. */
export type DiscoveryAvailability = "live" | "inactive" | "scheduled" | "ended" | "unknown";
export interface DiscoveryProof {
  availability?: DiscoveryAvailability;
  presenceKnown?: boolean;
  observedAt?: string | null;
  presenceExpiresAt?: string | null;
  /** Server-derived inactivity deadline; never extended by a discovery refresh. */
  resumeExpiresAt?: string | null;
  endsAt?: string | null;
  isOwner?: boolean;
  resumeAllowed?: boolean;
  createdBy?: string;
  isInvited?: boolean;
  /** Local request-start clocks. Network/authentication time consumes the lease. */
  requestStartedAt?: number;
  requestStartedMonotonic?: number;
}
export interface DiscoveryRoom extends DiscoveryProof {
  status?: "open" | "ended";
  isLive: boolean;
  listeners: number;
  maxParticipants?: number;
}
/** Server role permission must also belong to this authenticated viewer. */
export function hasDiscoveryResumeOwnership(room: DiscoveryProof, selfIds: string[]): boolean {
  return room.resumeAllowed === true && room.isOwner === true &&
    typeof room.createdBy === "string" && room.createdBy.length > 0 &&
    !/^\d+$/.test(room.createdBy) && selfIds.includes(room.createdBy);
}
const LEASE_MS = 90_000;
type Observation = { elapsed: number; liveExpired: boolean; ownerExpired: boolean; ended: boolean };
const observations = new WeakMap<object, Observation>();
const authorities = new WeakMap<object, { isCurrent: () => boolean; observation: Observation }>();
export const discoveryMonotonicNow = () => globalThis.performance?.now?.() ?? NaN;

/** Only current, authenticated discovery results get a runtime proof. It is never persisted. */
export function bindDiscoveryRoom<T extends DiscoveryRoom>(room: T, isCurrent: () => boolean): T {
  let observation = observations.get(room);
  if (!observation) {
    observation = { elapsed: 0, liveExpired: false, ownerExpired: false, ended: false };
    observations.set(room, observation);
  }
  const bound = { ...room };
  authorities.set(bound, { isCurrent, observation });
  return bound;
}

export function discoveryRoomState(room: DiscoveryRoom, now = Date.now(), monotonicNow = discoveryMonotonicNow()) {
  const authority = authorities.get(room);
  const observation = authority?.observation;
  const observedAt = Date.parse(room.observedAt ?? "");
  const expiresAt = Date.parse(room.presenceExpiresAt ?? "");
  const deadline = Date.parse(room.endsAt ?? "");
  const hasClocks = Number.isFinite(room.requestStartedAt) && Number.isFinite(room.requestStartedMonotonic) &&
    Number.isFinite(now) && Number.isFinite(monotonicNow);
  const elapsed = hasClocks ? Math.max(0, now - room.requestStartedAt!, monotonicNow - room.requestStartedMonotonic!, observation?.elapsed ?? 0) : Infinity;
  if (observation) observation.elapsed = elapsed;
  // Project the server clock using elapsed time, rather than comparing server ISO timestamps
  // with the device's absolute wall clock. A device clock rollback cannot lengthen a proof.
  const serverNow = observedAt + elapsed;
  const deadlineElapsed = Number.isFinite(deadline) && (Number.isFinite(serverNow) ? deadline <= serverNow : deadline <= now);
  const ended = room.status === "ended" || room.availability === "ended" || deadlineElapsed || observation?.ended === true;
  if (observation && ended) observation.ended = true;
  const lease = Math.min(LEASE_MS, expiresAt - observedAt);
  const liveExpired = !Number.isFinite(lease) || lease <= 0 || elapsed >= lease;
  const resumeDeadline = Date.parse(room.resumeExpiresAt ?? "");
  const resumeExpired = !Number.isFinite(resumeDeadline) || serverNow >= resumeDeadline;
  const ownerExpired = elapsed >= LEASE_MS || (room.availability !== "scheduled" && resumeExpired);
  if (observation) {
    observation.liveExpired ||= liveExpired;
    observation.ownerExpired ||= ownerExpired;
  }
  const current = authority?.isCurrent() === true;
  const fresh = current && hasClocks && Number.isFinite(observedAt) && !ended;
  const live = fresh && room.availability === "live" && room.presenceKnown === true && room.isLive === true &&
    !liveExpired && !observation?.liveExpired;
  const canResume = fresh && room.resumeAllowed === true && room.isOwner === true && room.status === "open" &&
    (room.availability === "live" || room.availability === "inactive" || room.availability === "scheduled") &&
    !ownerExpired && !observation?.ownerExpired;
  const countKnown = live || (ended && room.presenceKnown === true);
  const full = live && !!room.maxParticipants && room.listeners >= room.maxParticipants;
  const label = ended ? "Ended" : live ? "Live now" : room.availability === "scheduled" ? "Scheduled" :
    room.availability === "inactive" && room.isInvited ? "Waiting for host" : room.availability === "inactive" ? "Inactive" : "Status unavailable";
  return { ended, live, countKnown, full, label, canJoin: live, canResume,
    actionable: live || canResume,
    actionLabel: live ? full ? "Check room" : "Join" : canResume ? room.availability === "scheduled" ? "Start" : "Resume" : undefined };
}
