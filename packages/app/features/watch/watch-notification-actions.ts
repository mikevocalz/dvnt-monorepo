import type { WatchEventCommand, WatchEventResult } from "./watch-event-payload";
import type * as Notifications from "expo-notifications";
import { mmkv } from "@dvnt/app/lib/mmkv-zustand";
import { useWatchSessionStore } from "./watch-session-store";
import { Alert } from "react-native";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getCurrentUserRow } from "@dvnt/app/lib/auth/identity";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";

const readinessListeners = new Set<() => void>();
export function subscribeWatchNotificationReadiness(listener: () => void) {
  readinessListeners.add(listener); return () => { readinessListeners.delete(listener); };
}
function announceReadiness() { for (const listener of readinessListeners) listener(); }

type NotificationCallAction = "accept" | "accept_audio_only" | "decline";
let callHandler: ((roomId: string, action: NotificationCallAction) => boolean | Promise<boolean>) | undefined;
export function registerWatchNotificationCallHandler(handler: NonNullable<typeof callHandler>) {
  callHandler = handler;
  announceReadiness();
  return () => { if (callHandler === handler) callHandler = undefined; };
}
let eventHandler: ((raw: unknown) => Promise<WatchEventResult>) | undefined;
export function registerWatchNotificationEventHandler(handler: (raw: unknown) => Promise<WatchEventResult>) {
  eventHandler = handler;
  announceReadiness();
  return () => { if (eventHandler === handler) eventHandler = undefined; };
}
const eventAction = (id: string) => id === "DVNT_GOING" ? "going" : id === "DVNT_INTERESTED" ? "interested" : undefined;

const pendingKey = "watch-notification-pending-v2";
type Pending = { viewerId: string; generation: string; response: Notifications.NotificationResponse };
function pendingActions(): Pending[] {
  try {
    const stored: unknown = JSON.parse(mmkv.getString(pendingKey) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((item): item is Pending =>
      typeof item?.viewerId === "string" && typeof item?.generation === "string" &&
      typeof item?.response?.actionIdentifier === "string" &&
      typeof item?.response?.notification?.request?.identifier === "string" &&
      item?.response?.notification?.request?.content?.data !== null &&
      typeof item?.response?.notification?.request?.content?.data === "object"
    ).slice(0, 8);
  } catch { return []; }
}
function actionKey(response: Notifications.NotificationResponse): string {
  return `${response.notification.request.identifier}:${response.actionIdentifier}`;
}
function removePending(identifier: string, generation?: string) {
  mmkv.set(pendingKey, JSON.stringify(pendingActions().filter((p) => actionKey(p.response) !== identifier || (generation !== undefined && p.generation !== generation))));
}
useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id) mmkv.remove(pendingKey);
});
/** Failed explicit actions survive process death; reopening offers an explicit retry. */
export function restoreWatchNotificationActions() {
  const viewer = useAuthStore.getState().user?.id;
  const generation = useWatchSessionStore.getState().accountGen;
  for (const pending of pendingActions()) {
    if (pending.viewerId !== viewer || pending.generation !== generation) {
      removePending(actionKey(pending.response), pending.generation); continue;
    }
    Alert.alert("Action not confirmed", "An action is waiting for you to retry.", [
      { text: "Discard", style: "cancel", onPress: () => removePending(actionKey(pending.response), pending.generation) },
      { text: "Retry", onPress: () => { void handleWatchNotificationAction(pending.response); } },
    ]);
  }
}

const options = { opensAppToForeground: true, isAuthenticationRequired: true };
export async function registerWatchNotificationCategories(api: typeof Notifications) {
  await Promise.all([
    api.setNotificationCategoryAsync("DVNT_MESSAGE", [
      { identifier: "DVNT_REPLY", buttonTitle: "Reply", textInput: { submitButtonTitle: "Send", placeholder: "Message" }, options },
      { identifier: "DVNT_HEART", buttonTitle: "❤️", options },
      { identifier: "DVNT_READ", buttonTitle: "Mark read", options },
    ], { previewPlaceholder: "New message", showTitle: false, showSubtitle: false }),
    api.setNotificationCategoryAsync("DVNT_EVENT", [
      { identifier: "DVNT_GOING", buttonTitle: "Going", options },
      { identifier: "DVNT_INTERESTED", buttonTitle: "Interested", options },
      { identifier: "DVNT_OPEN_EVENT", buttonTitle: "View event", options },
    ]),
    api.setNotificationCategoryAsync("DVNT_WAITLIST", [{ identifier: "DVNT_OPEN_EVENT", buttonTitle: "Continue on phone", options }]),
    api.setNotificationCategoryAsync("DVNT_HOST", [{ identifier: "DVNT_OPEN_HOST", buttonTitle: "View door", options }]),
    api.setNotificationCategoryAsync("DVNT_TICKET", [{ identifier: "DVNT_OPEN_TICKET", buttonTitle: "Show pass", options }]),
    api.setNotificationCategoryAsync("DVNT_CALL", [
      { identifier: "DVNT_CALL_ACCEPT", buttonTitle: "Answer on phone", options },
      { identifier: "DVNT_CALL_AUDIO", buttonTitle: "Answer as audio", options },
      { identifier: "DVNT_CALL_DECLINE", buttonTitle: "Decline", options },
    ]),
  ]);
}

export function isWatchMessageAction(action: string) { return action === "DVNT_REPLY" || action === "DVNT_READ" || action === "DVNT_HEART"; }

/** Foreground action path: recipient-bound auth and backend-idempotent reply. */
export async function handleWatchNotificationAction(response: Notifications.NotificationResponse, navigate?: (route: string) => void): Promise<boolean | "deferred"> {
  const action = eventAction(response.actionIdentifier);
  const callAction: NotificationCallAction | undefined = response.actionIdentifier === "DVNT_CALL_ACCEPT" ? "accept" : response.actionIdentifier === "DVNT_CALL_AUDIO" ? "accept_audio_only" : response.actionIdentifier === "DVNT_CALL_DECLINE" ? "decline" : undefined;
  const openAction = ["DVNT_OPEN_EVENT", "DVNT_OPEN_HOST", "DVNT_OPEN_TICKET"].includes(response.actionIdentifier);
  if (!isWatchMessageAction(response.actionIdentifier) && !action && !callAction && !openAction) return false;
  const data = response.notification.request.content.data ?? {};
  const auth = useAuthStore.getState();
  const viewerId = auth.user?.id;
  const generation = useWatchSessionStore.getState().accountGen;
  const now = Date.now() / 1000;
  // Preserve the original OS response while authentication/handlers initialize.
  // Expired calls are consumed here and never enter the durable action queue.
  if (callAction && (typeof data.issuedAt !== "number" || !Number.isFinite(data.issuedAt) || now - data.issuedAt >= 30 || data.issuedAt > now + 30)) {
    Alert.alert("Call unavailable", "This call is no longer ringing. Check your phone."); return true;
  }
  if (!viewerId || auth.authStatus === "loading" || auth.isAuthenticated === false || !generation ||
      (callAction && !callHandler) || (action && !eventHandler)) return "deferred";
  const identity = viewerId ? await getCurrentUserRow().catch(() => null) : null;
  const recipientMatches = identity && (data.recipientAuthId === identity.authId || data.recipientId === String(identity.id));
  if (!viewerId || useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation || !recipientMatches || (!action && !callAction && !openAction && typeof data.conversationId !== "string") ||
      typeof data.issuedAt !== "number" || !Number.isFinite(data.issuedAt) || data.issuedAt > now + 30 || now - data.issuedAt > (callAction ? 30 : 86400)) {
    removePending(actionKey(response), generation);
    Alert.alert(action ? "Event unavailable" : "Message unavailable", "Open DVNT on your phone to continue."); return true;
  }
  if (callAction) {
    const roomId = typeof data.roomId === "string" ? data.roomId : "";
    const handler = callHandler;
    if (!handler) return "deferred";
    let accepted = false;
    // Capture after the identity await, then invoke synchronously: handler replacement
    // must not turn temporary unavailability into consumption of the original action.
    if (roomId) { try { accepted = await handler(roomId, callAction); } catch { /* unavailable */ } }
    if (!accepted) Alert.alert("Call unavailable", "This call is no longer ringing. Check your phone.");
    return true;
  }
  if (openAction) {
    const eventId = String(data.eventId ?? data.entityId ?? "");
    if (!/^[1-9][0-9]*$/.test(eventId) || !Number.isSafeInteger(Number(eventId)) || !navigate) {
      Alert.alert("Event unavailable", "Open DVNT on your phone to continue."); return true;
    }
    navigate(response.actionIdentifier === "DVNT_OPEN_HOST" ? `/(protected)/events/${eventId}/scanner` : response.actionIdentifier === "DVNT_OPEN_TICKET" ? `/(protected)/ticket/${eventId}` : `/(protected)/events/${eventId}`);
    return true;
  }
  if (response.actionIdentifier === "DVNT_HEART" &&
      (typeof data.messageId !== "string" || !/^[1-9][0-9]*$/.test(data.messageId) || !Number.isSafeInteger(Number(data.messageId)))) {
    removePending(actionKey(response), generation);
    Alert.alert("Message unavailable", "Open the conversation in DVNT to react."); return true;
  }
  const eventId = String(data.eventId ?? data.entityId ?? "");
  if (action && (!/^[1-9][0-9]*$/.test(eventId) || !Number.isSafeInteger(Number(eventId)))) {
    Alert.alert("Event unavailable", "Open DVNT on your phone to continue."); return true;
  }
  const conversationId = data.conversationId as string;
  const text = response.userText?.trim() ?? "";
  if (response.actionIdentifier === "DVNT_REPLY" && (!text || text.length > 500)) {
    Alert.alert("Reply not sent", "Use 1–500 characters. Open the conversation to edit your reply."); return true;
  }
  const identifier = actionKey(response);
  const existing = pendingActions().filter((p) => actionKey(p.response) !== identifier);
  if (existing.length >= 8) {
    Alert.alert("Reply not sent", "Resolve your pending message actions before sending another.");
    throw new Error("Pending notification queue full");
  }
  mmkv.set(pendingKey, JSON.stringify([...existing, { viewerId, generation, response }]));
  const perform = async () => {
    try {
      if (useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed");
      if (Date.now() / 1000 - Number(data.issuedAt) > 86400) { removePending(identifier, generation); throw new Error("Action expired"); }
      if (action) {
        if (!eventHandler) throw new Error("Open DVNT to continue");
        const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${viewerId}:${identifier}:${eventId}`);
        if (useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed");
        const now = Date.now() / 1000;
        const command: WatchEventCommand = { protocol: 2, accountGen: generation,
          operationId: `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`,
          type: "eventAction", eventId, action, issuedAt: now, expiresAt: now + 30 };
        const result = await eventHandler(command);
        if (result.status !== "confirmed") throw new Error(result.message ?? "Not confirmed");
        if (useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation) return;
        Alert.alert("RSVP confirmed", action === "going" ? "You’re going." : "Marked interested.");
      } else if (response.actionIdentifier === "DVNT_READ") {
        if (!(await messagesApi.markAsRead(conversationId, viewerId)).ok) throw new Error("Read not confirmed");
      } else if (response.actionIdentifier === "DVNT_HEART") {
        await messagesApi.reactToMessage(data.messageId as string, "❤️", { desiredPresent: true, expectedViewerId: viewerId });
      } else {
        const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${viewerId}:${response.notification.request.identifier}:${text}`);
        const operationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        if (useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed");
        const message = await messagesApi.sendMessage({ conversationId, content: text, operationId, expectedViewerId: viewerId });
        if (!message?.id) throw new Error("Send not confirmed");
      }
      removePending(identifier, generation);
    } catch {
      Alert.alert("Couldn’t confirm", "Your action wasn’t confirmed. Retry while connected or check on your phone.", [
        { text: "Later", style: "cancel" }, { text: "Retry", onPress: () => { void perform(); } },
      ]);
    }
  };
  await perform();
  return true;
}


const activeResponses = new Map<string, Promise<"handled" | "deferred" | "ignored">>();
/** Shared by warm delivery and cold replay; only consumption clears the OS response. */
export function consumeWatchNotificationResponse(response: Notifications.NotificationResponse,
    navigate: (route: string) => void, clear: () => Promise<void>): Promise<"handled" | "deferred" | "ignored"> {
  const key = `${actionKey(response)}:${response.userText ?? ""}:${useWatchSessionStore.getState().accountGen}`;
  const active = activeResponses.get(key);
  if (active) return active;
  const operation = Promise.resolve().then(async () => {
    const result = await handleWatchNotificationAction(response, navigate);
    if (result === "deferred") return "deferred" as const;
    if (!result) return "ignored" as const;
    await clear();
    return "handled" as const;
  });
  activeResponses.set(key, operation);
  void operation.finally(() => { if (activeResponses.get(key) === operation) activeResponses.delete(key); }).catch(() => {});
  return operation;
}
