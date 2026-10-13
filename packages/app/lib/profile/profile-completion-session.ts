import type { NewMemberProgress } from "./new-member-progress";

export type ProfileCompletionSession = { memberId: string; epoch: number };
export type ProfileCompletionSnapshot = {
  session: ProfileCompletionSession | null;
  status: "pending" | "error";
} | {
  session: ProfileCompletionSession;
  status: "ready";
  progress: NewMemberProgress;
};

export const EMPTY_PROFILE_COMPLETION: ProfileCompletionSnapshot = { session: null, status: "pending" };

/** Memory-only server evidence for one signed-in session, independent of React hosts/routes. */
export function createProfileCompletionSession(fetchProgress: () => Promise<NewMemberProgress>) {
  let snapshot = EMPTY_PROFILE_COMPLETION;
  let serial = 0;
  let requested = false;
  let inFlight = false;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const sameSession = (next: ProfileCompletionSession | null) =>
    next?.memberId === snapshot.session?.memberId && next?.epoch === snapshot.session?.epoch;

  function setSession(session: ProfileCompletionSession | null) {
    if (sameSession(session)) return;
    serial += 1;
    requested = false;
    inFlight = false;
    snapshot = session ? { session, status: "pending" } : EMPTY_PROFILE_COMPLETION;
    emit();
  }

  function ensure() {
    if (!snapshot.session || requested) return;
    requested = true;
    inFlight = true;
    const session = snapshot.session;
    const request = ++serial;
    // A synchronous throw must have the same fail-closed behavior as a rejection.
    void Promise.resolve().then(fetchProgress).then((progress) => {
      if (request !== serial || !sameSession(session)) return;
      inFlight = false;
      snapshot = { session, status: "ready", progress };
      emit();
    }, () => {
      if (request !== serial || !sameSession(session)) return;
      inFlight = false;
      snapshot = { session, status: "error" };
      emit();
    });
  }

  function invalidate(memberId: string) {
    if (snapshot.session?.memberId !== memberId) return;
    serial += 1;
    requested = false;
    snapshot = { session: snapshot.session, status: "pending" };
    emit();
    ensure();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setSession,
    ensure,
    invalidate,
    revalidate() {
      if (snapshot.status !== "ready" || inFlight) return;
      requested = false;
      ensure();
    },
    retry() { if (snapshot.session) invalidate(snapshot.session.memberId); },
  };
}
