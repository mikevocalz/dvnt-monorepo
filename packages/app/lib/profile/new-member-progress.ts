import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { supabase } from "@dvnt/app/lib/supabase/client";

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
  if (error || !data?.ok || !data.data)
    throw new Error(data?.error || error?.message || "Couldn't check your profile progress");
  return data.data;
}
