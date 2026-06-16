/**
 * Shared helper: resolve a Better Auth user to an app `users` row.
 * Auto-provisions a `users` row from the Better Auth `user` table
 * if one doesn't exist yet.
 *
 * Usage in any edge function:
 *   import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
 *   const userData = await resolveOrProvisionUser(supabaseAdmin, authUserId, selectFields);
 */

interface ResolvedUser {
  id: number;
  [key: string]: unknown;
}

/**
 * Look up the app `users` row for a Better Auth auth_id.
 * If no row exists, auto-create one from the Better Auth `user` table.
 *
 * @param supabase - Supabase admin client (service role)
 * @param authId - Better Auth user ID (the `user.id` string)
 * @param selectFields - Columns to select (default: "id")
 * @returns The `users` row, or null if the auth_id doesn't exist in Better Auth either
 */
export async function resolveOrProvisionUser(
  supabase: any,
  authId: string,
  selectFields = "id",
): Promise<ResolvedUser | null> {
  if (!authId) {
    console.error("[resolve-user] authId is empty/null");
    return null;
  }

  console.log(
    "[resolve-user] Resolving auth_id:",
    authId,
    "fields:",
    selectFields,
  );

  // 1. Try existing users row
  const { data: existing, error: existingErr } = await supabase
    .from("users")
    .select(selectFields)
    .eq("auth_id", authId)
    .single();

  if (existing) {
    console.log("[resolve-user] Found existing users row:", existing.id);
    return existing;
  }
  if (existingErr) {
    console.log(
      "[resolve-user] No users row for auth_id:",
      authId,
      "err:",
      existingErr.code,
    );
  }

  // 2. Look up Better Auth user table (include username column)
  const { data: baUser, error: baErr } = await supabase
    .from("user")
    .select("id, name, email, image, username")
    .eq("id", authId)
    .single();

  if (!baUser) {
    console.error(
      "[resolve-user] No Better Auth user found for id:",
      authId,
      "err:",
      baErr?.message,
    );
    return null;
  }
  console.log(
    "[resolve-user] Found Better Auth user:",
    baUser.email,
    "name:",
    baUser.name,
    "username:",
    baUser.username,
  );

  // 3. Auto-provision — ALWAYS prefer BA username column
  //    NOTE: users.id has NO auto-increment, must generate explicitly
  const displayName = (baUser.name || "").trim();
  const autoUsername =
    baUser.username ||
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") ||
    `user_${authId.slice(0, 8)}`;

  // Get next available ID
  const { data: maxRow } = await supabase
    .from("users")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .single();
  const nextId = (maxRow?.id || 0) + 1;
  console.log("[resolve-user] Next ID:", nextId, "username:", autoUsername);

  const { data: newRow, error: provisionErr } = await supabase
    .from("users")
    .insert({
      id: nextId,
      auth_id: authId,
      username: autoUsername,
      email: baUser.email || "",
      first_name: displayName.split(" ")[0] || "",
      last_name: displayName.split(" ").slice(1).join(" ") || "",
      verified: false,
      followers_count: 0,
      following_count: 0,
      posts_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select(selectFields)
    .single();

  if (newRow) {
    console.log(
      "[resolve-user] Auto-provisioned users row:",
      newRow.id,
      "for auth_id:",
      authId,
    );
    return newRow;
  }

  // Race condition: another call may have created the row
  if (provisionErr) {
    const { data: retryRow } = await supabase
      .from("users")
      .select(selectFields)
      .eq("auth_id", authId)
      .single();

    if (retryRow) return retryRow;

    console.error("[resolve-user] Auto-provision failed:", provisionErr);
  }

  return null;
}
