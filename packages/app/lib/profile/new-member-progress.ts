import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { describeFunctionError } from "@dvnt/app/lib/api/function-error";
import { readNewMemberProgress } from "./new-member-progress-contract";

export type NewMemberStep = "not_required" | "pending_verification" | "photo" | "first_post" | "complete";
export type NewMemberProgress = {
  step: NewMemberStep;
  required: boolean;
  hasPhoto: boolean;
  hasPost: boolean;
  emailVerified: boolean;
  adultVerified: boolean;
};

export async function fetchNewMemberProgress(): Promise<NewMemberProgress> {
  const token = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<{
    ok: boolean;
    data?: NewMemberProgress;
    error?: string;
  }>("new-member-progress", {
    body: {},
    headers: { Authorization: `Bearer ${token}`, "x-auth-token": token },
  });
  // supabase-js reports every non-2xx as one generic string; the function's
  // own reason ("Please sign in again", "Retry") is on the response body.
  if (error) throw new Error((await describeFunctionError(error)).message || "Couldn't check your profile progress");
  if (!data?.ok || !data.data) throw new Error(data?.error || "Couldn't check your profile progress");
  return readNewMemberProgress(data.data);
}

