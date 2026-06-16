/**
 * Structured Auth + Chat Breadcrumb Logger
 *
 * All auth and chat events go through this module for observability.
 * Uses console.log with structured prefixes for filtering in production logs.
 * Never logs raw tokens — only expiry timestamps and boolean presence.
 */

type AuthEvent =
  | "AUTH_BOOT_START"
  | "AUTH_SESSION_LOAD_START"
  | "AUTH_SESSION_LOAD_OK"
  | "AUTH_SESSION_LOAD_FAIL"
  | "AUTH_STATE_CHANGE"
  | "AUTH_REFRESH_START"
  | "AUTH_REFRESH_OK"
  | "AUTH_REFRESH_FAIL"
  | "AUTH_SIGNOUT_TRIGGERED"
  | "AUTH_STORAGE_READ_FAIL"
  | "AUTH_STORAGE_WRITE_FAIL"
  | "AUTH_REHYDRATION_START"
  | "AUTH_REHYDRATION_OK"
  | "AUTH_REHYDRATION_TIMEOUT"
  | "AUTH_MMKV_FALLBACK_OK"
  | "AUTH_MMKV_FALLBACK_FAIL"
  | "AUTH_IDENTITY_MISMATCH"
  | "AUTH_SYNC_START"
  | "AUTH_SYNC_OK"
  | "AUTH_SYNC_FAIL"
  | "AUTH_PERSISTED_KEEPALIVE";

type ChatEvent =
  | "CHAT_SEND_TAP"
  | "CHAT_SEND_MUTATION_ENTER"
  | "CHAT_SEND_PAYLOAD_BUILT"
  | "CHAT_SEND_TOKEN_START"
  | "CHAT_SEND_TOKEN_OK"
  | "CHAT_SEND_TOKEN_FAIL"
  | "CHAT_SEND_TOKEN_RETRY"
  | "CHAT_SEND_REQUEST_START"
  | "CHAT_SEND_RESPONSE"
  | "CHAT_SEND_UI_RECONCILE";

export type SignOutReason =
  | "USER_REQUESTED"
  | "ACCOUNT_DELETED"
  | "REFRESH_REVOKED"
  | "SECURESTORE_CORRUPT"
  | "POLICY_DENIED"
  | "UNRECOVERABLE_AUTH_ERROR";

interface AuthLogPayload {
  userId?: string;
  sessionPresent?: boolean;
  reason?: SignOutReason | string;
  error?: string;
  durationMs?: number;
  [key: string]: unknown;
}

interface ChatLogPayload {
  sendAttemptId?: string;
  clientMessageId?: string;
  conversationId?: string;
  textLen?: number;
  attachmentsCount?: number;
  status?: number | string;
  errorCode?: string;
  returnedRowId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

const PREFIX = "[DVNT]";

export function logAuth(event: AuthEvent, payload: AuthLogPayload = {}) {
  const ts = Date.now();
  const line = `${PREFIX}[Auth] ${event}`;
  console.log(line, { ...payload, _ts: ts });
}

export function logChat(event: ChatEvent, payload: ChatLogPayload = {}) {
  const ts = Date.now();
  const line = `${PREFIX}[Chat] ${event}`;
  console.log(line, { ...payload, _ts: ts });
}

/**
 * Token-safe refresh with single-flight mutex.
 *
 * Prevents concurrent refresh calls from racing and ensures only one
 * refresh is in-flight at any time. Returns the session or null.
 */
let refreshInFlight: Promise<any> | null = null;

export async function singleFlightGetSession(
  authClient: { getSession: () => Promise<any> },
): Promise<{ data: any; error: any }> {
  if (refreshInFlight) {
    logAuth("AUTH_REFRESH_START", { reason: "joined_existing_flight" });
    return refreshInFlight;
  }

  logAuth("AUTH_REFRESH_START", { reason: "new_flight" });
  const start = Date.now();

  refreshInFlight = authClient
    .getSession()
    .then((result: any) => {
      const durationMs = Date.now() - start;
      if (result.error) {
        logAuth("AUTH_REFRESH_FAIL", {
          error: String(result.error),
          durationMs,
        });
      } else {
        logAuth("AUTH_REFRESH_OK", {
          sessionPresent: !!result.data?.session,
          durationMs,
        });
      }
      return result;
    })
    .catch((err: any) => {
      logAuth("AUTH_REFRESH_FAIL", {
        error: String(err),
        durationMs: Date.now() - start,
      });
      return { data: null, error: String(err) };
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}
