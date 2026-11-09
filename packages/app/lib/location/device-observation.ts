/** Proof belongs to the provider's observation, never the time consent was
 * accepted or a cached coordinate was republished. It is deliberately volatile. */
export interface DeviceObservation {
  observedAt: number;
  ownerAuthId: string | undefined;
  sessionKey: string | undefined;
}
export function freshDeviceObservation(
  observation: DeviceObservation | null | undefined,
  owner: string | null | undefined,
  sessionKey: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!observation || !owner || !sessionKey || observation.ownerAuthId !== owner ||
      observation.sessionKey !== sessionKey || !Number.isFinite(observation.observedAt) ||
      observation.observedAt <= 0 || now - observation.observedAt > 60_000 ||
      observation.observedAt > now + 5_000) return null;
  return observation.observedAt;
}
