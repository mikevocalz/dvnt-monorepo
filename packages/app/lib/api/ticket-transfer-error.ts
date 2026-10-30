/** Only structured client refusals are displayable. Never show SDK, SQL or proxy errors. */
export async function ticketTransferError(error: unknown): Promise<string> {
  const fallback = "Could not complete the transfer. Check My Tickets before trying again.";
  const value = error as { message?: string; context?: Response } | null;
  if (value?.message === "Not authenticated - no Better Auth token available") {
    return "Please sign in again to manage your ticket transfer.";
  }
  const response = value?.context;
  if (response?.status === 401) return "Please sign in again to manage your ticket transfer.";
  if (!response || response.status < 400 || response.status > 599) return fallback;
  try {
    // Cloning preserves the response for diagnostics/other consumers.
    const body = await response.clone().json();
    const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
    if (response.status >= 500) {
      return response.status === 503 && [
        "Could not verify the recipient. Please try again.",
        "Could not start transfer. Please try again.",
        "Could not accept transfer. Check My Tickets and try again.",
      ].includes(detail) ? detail : fallback;
    }
    if (typeof detail === "string" && detail.trim() && detail.length <= 300 && !/[<>\u0000-\u001f]/.test(detail)) {
      return detail.trim();
    }
  } catch {
    // Malformed, consumed or non-JSON bodies are not user-facing messages.
  }
  return fallback;
}
