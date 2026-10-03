import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { supabase } from "@dvnt/app/lib/supabase/client";

export interface StartAdultVerificationResult {
  status: string;
  url?: string;
  sessionId?: string;
}

/**
 * Click-path transport for SPICY verification.
 *
 * Kept out of the always-loaded feed graph: the server remains authoritative
 * for NSFW writes, while Supabase/auth verification code is loaded only when
 * someone actually tries to enable SPICY.
 */
export async function startSpicyVerification(): Promise<StartAdultVerificationResult> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    data?: StartAdultVerificationResult;
    error?: { code?: string; message?: string };
  }>("create-verification-session", {
    body: {},
    headers: {
      Authorization: `Bearer ${token}`,
      "x-auth-token": token,
    },
  });

  if (error) {
    throw new Error(error.message || "Couldn't start verification");
  }
  if (!data?.ok || !data.data) {
    throw new Error(data?.error?.message || "Couldn't start verification");
  }
  return data.data;
}
