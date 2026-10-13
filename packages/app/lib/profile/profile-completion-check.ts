import type { NewMemberProgress } from "./new-member-progress.ts";

/** A result belongs only to the member, navigation and retry that requested it. */
export interface ProfileCompletionScope {
  memberId: string;
  pathname: string;
  reload: number;
}

export type ProfileCompletionCheck =
  | { status: "idle" }
  | { status: "pending"; scope: ProfileCompletionScope; progress?: NewMemberProgress }
  | { status: "error"; scope: ProfileCompletionScope }
  | { status: "ready"; scope: ProfileCompletionScope; progress: NewMemberProgress };

export type ProfileCompletionCheckAction =
  | { type: "reset" }
  | { type: "start"; scope: ProfileCompletionScope }
  | { type: "reject"; scope: ProfileCompletionScope }
  | { type: "resolve"; scope: ProfileCompletionScope; progress: NewMemberProgress };

export const INITIAL_PROFILE_COMPLETION_CHECK: ProfileCompletionCheck = { status: "idle" };

function sameScope(a: ProfileCompletionScope, b: ProfileCompletionScope): boolean {
  return a.memberId === b.memberId && a.pathname === b.pathname && a.reload === b.reload;
}

export function profileCompletionCheckReducer(
  state: ProfileCompletionCheck,
  action: ProfileCompletionCheckAction,
): ProfileCompletionCheck {
  if (action.type === "reset") return INITIAL_PROFILE_COMPLETION_CHECK;
  if (action.type === "start") {
    const previous = readProfileCompletionCheck(state, action.scope);
    return {
      status: "pending",
      scope: action.scope,
      ...(previous.status === "ready" ? { progress: previous.progress } : {}),
    };
  }
  // Late reads cannot unlock a different account, navigation, or retry.
  if (state.status === "idle" || !sameScope(state.scope, action.scope)) return state;
  if (action.type === "reject") return { status: "error", scope: action.scope };
  return { status: "ready", scope: action.scope, progress: action.progress };
}

/**
 * A route change does not erase server evidence for the same member. Recheck
 * in the background, preserving both completion and any outstanding required
 * steps. Initial reads, account/session changes, retries and failed reads still
 * block. Nothing is persisted or inferred from the local profile.
 */
export function readProfileCompletionCheck(
  state: ProfileCompletionCheck,
  scope: ProfileCompletionScope,
): { status: "pending" | "error" } | { status: "ready"; progress: NewMemberProgress } {
  if (state.status === "idle" || state.scope.memberId !== scope.memberId ||
      state.scope.reload !== scope.reload) return { status: "pending" };
  if (state.status === "ready" || (state.status === "pending" && state.progress)) {
    return { status: "ready", progress: state.progress! };
  }
  return { status: sameScope(state.scope, scope) ? state.status : "pending" };
}
