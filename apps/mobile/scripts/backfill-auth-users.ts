/**
 * One-off script: Backfill missing users from Better Auth `user` table
 * into the app `users` table.
 *
 * Usage: npx tsx scripts/backfill-auth-users.ts
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

// Parse .env manually to avoid dotenv dependency
const envPath = resolve(__dirname, "../.env");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TEST_EMAILS = ["@test.com", "@example.com", "@deviant.test"];

async function main() {
  // 1. Get all auth_ids already in the users table
  const { data: existingUsers } = await supabase
    .from("users")
    .select("auth_id");
  const existingAuthIds = new Set(
    (existingUsers || []).map((u: any) => u.auth_id).filter(Boolean),
  );
  console.log(`Existing users with auth_id: ${existingAuthIds.size}`);

  // 2. Get all users from Better Auth user table
  const { data: authUsers, error } = await supabase
    .from("user")
    .select("id, name, email, image, createdAt")
    .order("createdAt", { ascending: false });

  if (error) {
    console.error("Failed to fetch auth users:", error);
    process.exit(1);
  }

  // 3. Find missing users (not in users table, not test accounts)
  const missing = (authUsers || []).filter((u: any) => {
    if (existingAuthIds.has(u.id)) return false;
    const email = (u.email || "").toLowerCase();
    if (TEST_EMAILS.some((t) => email.endsWith(t))) return false;
    const name = (u.name || "").trim();
    if (!name || name.toLowerCase().startsWith("test")) return false;
    return true;
  });

  console.log(`Missing users to backfill: ${missing.length}`);

  if (missing.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // 4. Insert each missing user
  let success = 0;
  let failed = 0;
  for (const u of missing) {
    const displayName = (u.name || "").trim();
    const parts = displayName.split(/\s+/);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";
    const username =
      displayName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || u.id.slice(0, 12);

    // Check for username collision
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    const finalUsername = existing
      ? `${username}_${u.id.slice(0, 6)}`
      : username;

    const { error: insertError } = await supabase.from("users").insert({
      auth_id: u.id,
      username: finalUsername,
      email: u.email,
      first_name: firstName,
      last_name: lastName || null,
      verified: false,
      followers_count: 0,
      following_count: 0,
      posts_count: 0,
      is_private: false,
    });

    if (insertError) {
      console.error(
        `  FAILED: ${displayName} (${u.email}): ${insertError.message}`,
      );
      failed++;
    } else {
      console.log(`  OK: ${finalUsername} — ${displayName} (${u.email})`);
      success++;
    }
  }

  console.log(`\nDone: ${success} inserted, ${failed} failed.`);
}

main().catch(console.error);
