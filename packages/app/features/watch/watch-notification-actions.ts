import type * as Notifications from "expo-notifications";
import { mmkv } from "@dvnt/app/lib/mmkv-zustand";
import { useWatchSessionStore } from "./watch-session-store";
import { Alert } from "react-native";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getCurrentUserRow } from "@dvnt/app/lib/auth/identity";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";

const pendingKey = "watch-notification-pending-v2";
type Pending = { viewerId: string; generation: string; response: Notifications.NotificationResponse };
function pendingActions(): Pending[] {
  try { return JSON.parse(mmkv.getString(pendingKey) ?? "[]"); } catch { return []; }
}
function removePending(identifier: string, generation?: string) {
  mmkv.set(pendingKey, JSON.stringify(pendingActions().filter((p) => p.response.notification.request.identifier !== identifier || (generation !== undefined && p.generation !== generation))));
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
      removePending(pending.response.notification.request.identifier, pending.generation); continue;
    }
    Alert.alert("Action not confirmed", "A message action is waiting for you to retry.", [
      { text: "Discard", style: "cancel", onPress: () => removePending(pending.response.notification.request.identifier, pending.generation) },
      { text: "Retry", onPress: () => { void handleWatchNotificationAction(pending.response); } },
    ]);
  }
}

const options = { opensAppToForeground: true, isAuthenticationRequired: true };
export async function registerWatchNotificationCategories(api: typeof Notifications) {
  await Promise.all([
    api.setNotificationCategoryAsync("DVNT_MESSAGE", [
      { identifier: "DVNT_REPLY", buttonTitle: "Reply", textInput: { submitButtonTitle: "Send", placeholder: "Message" }, options },
      { identifier: "DVNT_READ", buttonTitle: "Mark read", options },
    ], { previewPlaceholder: "New message", showTitle: false, showSubtitle: false }),
    api.setNotificationCategoryAsync("DVNT_EVENT", [{ identifier: "DVNT_OPEN_EVENT", buttonTitle: "View event", options }]),
    api.setNotificationCategoryAsync("DVNT_TICKET", [{ identifier: "DVNT_OPEN_TICKET", buttonTitle: "Show pass", options }]),
    api.setNotificationCategoryAsync("DVNT_CALL", [{ identifier: "DVNT_OPEN_CALL", buttonTitle: "Open call", options }]),
  ]);
}

export function isWatchMessageAction(action: string) { return action === "DVNT_REPLY" || action === "DVNT_READ"; }

/** Foreground action path: recipient-bound auth and backend-idempotent reply. */
export async function handleWatchNotificationAction(response: Notifications.NotificationResponse): Promise<boolean> {
  if (!isWatchMessageAction(response.actionIdentifier)) return false;
  const data = response.notification.request.content.data ?? {};
  const viewerId = useAuthStore.getState().user?.id;
  const generation = useWatchSessionStore.getState().accountGen;
  const now = Date.now() / 1000;
  const identity = viewerId ? await getCurrentUserRow() : null;
  const recipientMatches = identity && (data.recipientAuthId === identity.authId || data.recipientId === String(identity.id));
  if (!viewerId || useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation || !recipientMatches || typeof data.conversationId !== "string" ||
      typeof data.issuedAt !== "number" || data.issuedAt > now + 30 || now - data.issuedAt > 86400) {
    removePending(response.notification.request.identifier, generation);
    Alert.alert("Message unavailable", "Open the conversation in DVNT to continue."); return true;
  }
  const conversationId = data.conversationId;
  const text = response.userText?.trim() ?? "";
  if (response.actionIdentifier === "DVNT_REPLY" && (!text || text.length > 500)) {
    Alert.alert("Reply not sent", "Use 1–500 characters. Open the conversation to edit your reply."); return true;
  }
  const identifier = response.notification.request.identifier;
  const existing = pendingActions().filter((p) => p.response.notification.request.identifier !== identifier);
  if (existing.length >= 8) {
    Alert.alert("Reply not sent", "Resolve your pending message actions before sending another.");
    throw new Error("Pending notification queue full");
  }
  mmkv.set(pendingKey, JSON.stringify([...existing, { viewerId, generation, response }]));
  const perform = async () => {
    try {
      if (useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed");
      if (Date.now() / 1000 - Number(data.issuedAt) > 86400) { removePending(identifier, generation); throw new Error("Action expired"); }
      if (response.actionIdentifier === "DVNT_READ") {
        if (!(await messagesApi.markAsRead(conversationId, viewerId)).ok) throw new Error("Read not confirmed");
      } else {
        const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${viewerId}:${response.notification.request.identifier}:${text}`);
        const operationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
        if (useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed");
        await messagesApi.sendMessage({ conversationId, content: text, operationId, expectedViewerId: viewerId });
      }
      removePending(identifier, generation);
    } catch {
      Alert.alert("Couldn’t confirm", "Your action wasn’t confirmed. Retry while connected or open the conversation.", [
        { text: "Later", style: "cancel" }, { text: "Retry", onPress: () => { void perform(); } },
      ]);
    }
  };
  await perform();
  return true;
}
