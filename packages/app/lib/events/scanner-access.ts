import { canScanTickets, type EventRole } from "./event-role.ts";

/** A failed role lookup is not a negative permission decision. */
export function scannerAccessGate(input: {
  hasHydrated: boolean;
  isAuthenticated: boolean;
  loading: boolean;
  role: EventRole;
  roleError: boolean;
  errorStatus?: number;
  canOpenOffline?: boolean;
  rolePending?: boolean;
  rolePaused?: boolean;
}): "loading" | "signed_out" | "cannot_verify" | "not_staff" | "open" {
  if (!input.hasHydrated) return "loading";
  if (!input.isAuthenticated) return "signed_out";
  // A real server refusal outranks cached staff/offline state.
  if (input.errorStatus === 401) return "signed_out";
  if (input.errorStatus === 403) return "not_staff";
  if (input.rolePending && input.rolePaused) return input.canOpenOffline ? "open" : "cannot_verify";
  if (input.loading || input.rolePending) return "loading";
  // A previously confirmed cached role can survive a transient refetch error;
  // the server still authorizes every check-in against the current session.
  if (canScanTickets(input.role)) return "open";
  if (input.roleError) return input.canOpenOffline ? "open" : "cannot_verify";
  return "not_staff";
}
