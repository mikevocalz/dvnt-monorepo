/**
 * Privileged Database Operations
 *
 * This module contains wrappers for database operations that require
 * elevated privileges (service role). These operations are performed
 * via Supabase Edge Functions to keep the service role key secure.
 *
 * IMPORTANT: Never update the users table directly from app code.
 * Always use these wrappers for privileged writes.
 */

import { supabase } from "./client";
import { getAuthToken } from "../auth-client";
import type { AppUser } from "../auth-client";

interface UpdateProfileParams {
  name?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  bio?: string;
  location?: string;
  website?: string;
  links?: string[];
  avatarUrl?: string;
  pronouns?: string;
  gender?: string;
}

interface PrivilegedResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

/**
 * Update the current user's profile via Edge Function.
 * This bypasses RLS by using the service role key server-side.
 *
 * @param updates - Profile fields to update
 * @returns Updated user data or throws error
 */
export async function updateProfilePrivileged(
  updates: UpdateProfileParams,
): Promise<AppUser> {
  console.log("[Privileged] updateProfilePrivileged called with:", updates);

  // Get Better Auth token
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Not authenticated");
  }

  // Call Edge Function
  const { data, error } = await supabase.functions.invoke<
    PrivilegedResponse<{ user: AppUser }>
  >("update-profile", {
    body: updates,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (error) {
    console.error("[Privileged] Edge Function error:", error);
    throw new Error(error.message || "Failed to update profile");
  }

  if (!data?.ok || !data?.data?.user) {
    const errorMessage = data?.error?.message || "Failed to update profile";
    console.error("[Privileged] Update failed:", errorMessage);
    throw new Error(errorMessage);
  }

  console.log("[Privileged] Profile updated successfully:", data.data.user.id);
  return data.data.user;
}

/**
 * Delete the current user's account via Edge Function.
 * Permanently deletes all user data, cancels subscriptions,
 * anonymizes financial records.
 *
 * @returns Success status
 */
export async function deleteAccountPrivileged(): Promise<boolean> {
  console.log("[Privileged] deleteAccountPrivileged called");

  const token = await getAuthToken();
  if (!token) {
    throw new Error("Not authenticated");
  }

  // Client-side CallKeep cleanup BEFORE the server tears down the account.
  // The server cascade deletes push_tokens and ends video_rooms, but the
  // iOS Telecom framework still holds onto any registered call connections
  // for this device. Without ending them first, callkeep can deliver a
  // ghost incoming-call UI to the deleted account on the next VOIP push.
  // Wrapped in try/catch because callkeep may not be initialised in
  // every code path (e.g. account created and deleted without ever
  // receiving a call).
  try {
    const { endAllCalls } = await import("@dvnt/app/src/services/callkeep/callkeep");
    endAllCalls();
  } catch (callkeepErr) {
    console.warn(
      "[Privileged] CallKeep cleanup before delete failed (non-fatal):",
      callkeepErr,
    );
  }

  const { data, error } = await supabase.functions.invoke<
    PrivilegedResponse<null>
  >("delete-account", {
    body: { confirm: true },
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (error) {
    console.error("[Privileged] Delete account error:", error);
    throw new Error(error.message || "Failed to delete account");
  }

  if (!data?.ok && (data as any)?.error) {
    throw new Error((data as any).error);
  }

  console.log("[Privileged] Account deleted successfully");
  return true;
}
