/**
 * Type and web-runtime shim for `expo-callkit-telecom`.
 *
 * apps/mobile pins the package to upstream PR commit 348cdc0f via a github:
 * specifier. That commit's `prepare` script is a noop, so the fetched tarball
 * ships no build/ output and its declared `types` entry does not exist —
 * every importer reports TS2307 and the web bundle cannot resolve it.
 *
 * Declarations here mirror src/Calls.ts and src/Calls.types.ts at the pinned
 * commit. Drop this file, the tsconfig `paths` entries, and the next.config
 * alias once the dependency moves to a published npm release.
 */
export interface CallParticipant {
  id: string;
  displayName?: string;
  avatarUrl?: string;
  phoneNumber?: string;
  email?: string;
}

export interface CallOptions {
  hasVideo: boolean;
}

export type CallSessionStatus =
  | "requesting"
  | "connecting"
  | "ringing"
  | "connected"
  | "ended";

export type CallSessionOrigin = "incoming" | "outgoingApp" | "outgoingSystem";

export interface CallSession {
  id: string;
  options: CallOptions;
  origin: CallSessionOrigin;
  remoteParticipants: CallParticipant[];
  status: CallSessionStatus;
  connectedAt?: string;
  isMuted: boolean;
  isOnHold: boolean;
  dtmfDigits?: string;
}

export interface NativeEventMeta {
  flushed: boolean;
  timestamp: string;
}

export interface NativeEvent {
  meta: NativeEventMeta;
}

export interface CallActionEvent extends NativeEvent {
  id: string;
}

export interface CallAnsweredEvent extends CallActionEvent {
  requestId: string;
}

export interface CallEndedEvent extends CallActionEvent {
  session: CallSession;
}

export interface SetMutedActionEvent extends CallActionEvent {
  isMuted: boolean;
}

export interface AudioSessionCallInfo {
  id: string;
  status: CallSessionStatus;
}

export interface AudioSessionActivatedEvent extends NativeEvent {
  calls: AudioSessionCallInfo[];
}

export type CallEndedReason =
  | "failed"
  | "remoteEnded"
  | "unanswered"
  | "answeredElsewhere"
  | "declinedElsewhere"
  | "unknown";

export interface IncomingCallEvent {
  eventId: string;
  serverCallId: string;
  hasVideo: boolean;
  startedAt?: string;
  caller: CallParticipant;
  metadata?: Record<string, unknown>;
}

export interface EventSubscription {
  remove(): void;
}

const noopSubscription = (): EventSubscription => ({ remove: () => {} });

export function getActiveCallSession(): Promise<CallSession | null> {
  return Promise.resolve(null);
}
export function startOutgoingCall(
  _recipient: CallParticipant,
  _options: CallOptions,
): Promise<string> {
  return Promise.reject(new Error("expo-callkit-telecom is iOS/Android only"));
}
export function reportIncomingCall(_event: IncomingCallEvent): Promise<void> {
  return Promise.resolve();
}
export function reportOutgoingCallConnected(_id: string): Promise<void> {
  return Promise.resolve();
}
export function fulfillIncomingCallConnected(
  _requestId: string,
): Promise<void> {
  return Promise.resolve();
}
export function endCall(_id: string): Promise<void> {
  return Promise.resolve();
}
export function reportCallEnded(
  _id: string,
  _reason: CallEndedReason,
): Promise<void> {
  return Promise.resolve();
}
export function setMuted(_id: string, _muted: boolean): Promise<void> {
  return Promise.resolve();
}
export function prepareAudioSessionForCall(_hasVideo: boolean): void {}
export function restoreAudioSession(): void {}
export function addCallAnsweredListener(
  _listener: (event: CallAnsweredEvent) => void,
): EventSubscription {
  return noopSubscription();
}
export function addCallEndedListener(
  _listener: (event: CallEndedEvent) => void,
): EventSubscription {
  return noopSubscription();
}
export function addSetMutedActionListener(
  _listener: (event: SetMutedActionEvent) => void,
): EventSubscription {
  return noopSubscription();
}
export function addAudioSessionActivatedListener(
  _listener: (event: AudioSessionActivatedEvent) => void,
): EventSubscription {
  return noopSubscription();
}
