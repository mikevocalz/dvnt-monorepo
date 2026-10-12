import type { NewMemberProgress } from "./new-member-progress.ts";

/** A result belongs only to the member, navigation and retry that requested it. */
export interface ProfileCompletionScope {
  memberId: string;
  pathname: string;
  reload: number;
}

export type ProfileCompletionCheck =
  | { status: "idle" }
  | { status: "pending" | "error"; scope: ProfileCompletionScope }
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
  if (action.type === "start") return { status: "pending", scope: action.scope };
  // Late reads cannot unlock a different account, navigation, or retry.
  if (state.status === "idle" || !sameScope(state.scope, action.scope)) return state;
  if (action.type === "reject") return { status: "error", scope: action.scope };
  return { status: "ready", scope: action.scope, progress: action.progress };
}

/**
 * Compare during render, before an effect can reset stale state. A previous
 * member's completed result is never evidence for the current member.
 */
export function readProfileCompletionCheck(
  state: ProfileCompletionCheck,
  scope: ProfileCompletionScope,
): { status: "pending" | "error" } | { status: "ready"; progress: NewMemberProgress } {
  if (state.status === "idle" || !sameScope(state.scope, scope)) return { status: "pending" };
  if (state.status === "ready") return { status: "ready", progress: state.progress };
  return { status: state.status };
}
