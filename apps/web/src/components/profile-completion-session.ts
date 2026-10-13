"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { fetchNewMemberProgress } from "@dvnt/app/lib/profile/new-member-progress";
import { subscribeProfileCompletionInvalidation } from "@dvnt/app/lib/profile/profile-completion-invalidation";
import { createProfileCompletionSession, EMPTY_PROFILE_COMPLETION } from "@dvnt/app/lib/profile/profile-completion-session";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";

// No SSR/account-global cache, storage, or component-owned completion state.
let client: ReturnType<typeof createProfileCompletionSession> | undefined;
function getClient() {
  if (client) return client;
  const store = createProfileCompletionSession(fetchNewMemberProgress);
  client = store;
  let epoch = 0;
  let previousMember = "";
  let previousLifecycle = getSessionLifecycle();
  const sync = () => {
    const auth = useAuthStore.getState();
    const lifecycle = getSessionLifecycle();
    const member = auth.isAuthenticated ? auth.user?.authId || String(auth.user?.id ?? "") : "";
    if (member !== previousMember || lifecycle !== previousLifecycle) {
      epoch += 1; previousMember = member; previousLifecycle = lifecycle;
    }
    // Auth mutation may complete before its profile snapshot arrives. Never
    // attach the new session's server response to a previous account's UI.
    const matchesSession = !lifecycle.authId || lifecycle.authId === (auth.user?.authId || auth.user?.id);
    store.setSession(member && lifecycle.ready && matchesSession
      ? { memberId: member, epoch }
      : null);
  };
  const syncAndEnsure = () => {
    sync();
    if (useAuthStore.getState()._hasHydrated) store.ensure();
  };
  // These subscriptions live with the browser session, not with a popup mount:
  // a logout and same-account login while the host is absent still clears proof.
  useAuthStore.subscribe(syncAndEnsure);
  subscribeSessionLifecycle(syncAndEnsure);
  subscribeProfileCompletionInvalidation((member) => store.invalidate(member));
  // Detect changes made in another tab/device without coupling reads to links.
  // The last confirmed result remains visible during this background read;
  // incomplete responses or failures still close the gate immediately.
  let lastRefresh = Date.now();
  const revalidate = () => {
    if (document.visibilityState === "hidden" || !useAuthStore.getState()._hasHydrated) return;
    const now = Date.now();
    const state = store.getSnapshot();
    const awaitingVerification = state.status === "ready" && state.progress.step === "pending_verification";
    if (!awaitingVerification && now - lastRefresh < 60_000) return;
    lastRefresh = now;
    store.revalidate();
  };
  window.addEventListener("focus", revalidate);
  document.addEventListener("visibilitychange", revalidate);
  window.setInterval(revalidate, 60_000);
  sync();
  return store;
}
const subscribe = (listener: () => void) => getClient().subscribe(listener);
const getSnapshot = () => typeof window === "undefined" ? EMPTY_PROFILE_COMPLETION : getClient().getSnapshot();
const getServerSnapshot = () => EMPTY_PROFILE_COMPLETION;

export function useProfileCompletionSession(memberId: string, ready: boolean, pathname: string, verificationOpen: boolean) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => { if (ready) getClient().ensure(); }, [ready, memberId]);
  // Verification may complete in a separate hosted tab. Recheck this one
  // transitional state when navigation resumes or its prompt closes.
  useEffect(() => {
    const state = getClient().getSnapshot();
    if (ready && !verificationOpen && state.status === "ready" && state.progress.step === "pending_verification") {
      getClient().revalidate();
    }
  }, [ready, pathname, verificationOpen]);
  // Auth changes can render before the external-store listener runs.
  const check = snapshot.session?.memberId === memberId ? snapshot : EMPTY_PROFILE_COMPLETION;
  return { check, retry: () => getClient().retry() };
}
