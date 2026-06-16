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
import {
  deleteAccountPrivileged as deleteAccountPrivilegedShared,
  updateProfilePrivileged as updateProfilePrivilegedShared,
  type UpdateProfileParams,
} from "@dvnt/functions/supabase";

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

  const user = await updateProfilePrivilegedShared<AppUser>({
    supabase,
    getAuthToken,
    updates,
  });

  console.log("[Privileged] Profile updated successfully:", user.id);
  return user;
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

  // Client-side CallKeep cleanup BEFORE the server tears down the account.
  // The server cascade deletes push_tokens and ends video_rooms, but the
  // iOS Telecom framework still holds onto any registered call connections
  // for this device. Without ending them first, callkeep can deliver a
  // ghost incoming-call UI to the deleted account on the next VOIP push.
  // Wrapped in try/catch because callkeep may not be initialised in
  // every code path (e.g. account created and deleted without ever
  // receiving a call).
  const result = await deleteAccountPrivilegedShared({
    supabase,
    getAuthToken,
    beforeDelete: async () => {
      try {
        const { endAllCalls } = await import("@/src/services/callkeep/callkeep");
        endAllCalls();
      } catch (callkeepErr) {
        console.warn(
          "[Privileged] CallKeep cleanup before delete failed (non-fatal):",
          callkeepErr,
        );
      }
    },
  });

  console.log("[Privileged] Account deleted successfully");
  return result;
}
