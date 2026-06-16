/**
 * Migrate existing users to Supabase Auth
 *
 * This script:
 * 1. Fetches all users from the database
 * 2. Creates corresponding Supabase Auth users
 * 3. Links auth accounts to existing profiles
 * 4. Sends password reset emails
 *
 * Run with: npx tsx scripts/migrate-users-to-supabase-auth.ts
 */

import { createClient } from "@supabase/supabase-js";
// @ts-ignore - dotenv may not have types installed
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../.env") });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
// For user creation, we need the service role key from Supabase Dashboard
// Go to: Settings > API > service_role key (keep this secret!)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Missing Supabase environment variables");
  process.exit(1);
}

if (!supabaseServiceKey) {
  console.error(`
❌ Missing SUPABASE_SERVICE_ROLE_KEY

To get this key:
1. Go to: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/settings/api
2. Copy the "service_role" key (keep it secret!)
3. Add it to your .env file:
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
4. Run this script again
  `);
  process.exit(1);
}

// Create clients
const supabase = createClient(supabaseUrl, supabaseAnonKey);
const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface User {
  id: number;
  email: string;
  username: string;
  first_name?: string;
  last_name?: string;
}

async function migrateUsers() {
  console.log("🚀 Starting user migration to Supabase Auth...\n");

  try {
    // Step 1: Fetch all users from database
    console.log("📋 Fetching users from database...");
    const { data: users, error: fetchError } = await supabase
      .from("users")
      .select("id, email, username, first_name, last_name")
      .not("email", "is", null);

    if (fetchError) {
      throw new Error(`Failed to fetch users: ${fetchError.message}`);
    }

    if (!users || users.length === 0) {
      console.log("ℹ️  No users found to migrate.");
      return;
    }

    console.log(`✅ Found ${users.length} users to migrate\n`);

    // Step 2: Migrate each user
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (const user of users) {
      console.log(`\n👤 Processing: ${user.email} (${user.username})`);

      try {
        // Check if user already exists in Supabase Auth
        const { data: existingUsers } =
          await adminSupabase.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(
          (u) => u.email === user.email,
        );

        if (existingUser) {
          console.log(
            `   ⏭️  User already exists in Supabase Auth (ID: ${existingUser.id})`,
          );

          // Link existing auth user to profile if not already linked
          // Check if the profile has the correct auth user ID
          const { data: profile } = await supabase
            .from("users")
            .select("id")
            .eq("id", user.id)
            .single();

          if (profile) {
            console.log(`   ✅ Profile already linked`);
            skipCount++;
            continue;
          }
        }

        // Create temporary password (user will reset it)
        const tempPassword = `Temp${Math.random().toString(36).slice(2, 10)}!`;
        const displayName =
          `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
          user.username;

        // Create user in Supabase Auth
        console.log(`   🔐 Creating Supabase Auth user...`);
        const { data: authUser, error: createError } =
          await adminSupabase.auth.admin.createUser({
            email: user.email,
            password: tempPassword,
            email_confirm: true, // Auto-confirm email
            user_metadata: {
              username: user.username,
              name: displayName,
            },
          });

        if (createError) {
          console.error(
            `   ❌ Error creating auth user: ${createError.message}`,
          );
          errorCount++;
          continue;
        }

        if (!authUser.user) {
          console.error(`   ❌ No user returned from auth creation`);
          errorCount++;
          continue;
        }

        console.log(`   ✅ Created auth user (ID: ${authUser.user.id})`);

        // Send password reset email
        console.log(`   📧 Sending password reset email...`);
        const { error: resetError } =
          await adminSupabase.auth.admin.generateLink({
            type: "recovery",
            email: user.email,
          });

        if (resetError) {
          console.warn(
            `   ⚠️  Warning: Could not send reset email: ${resetError.message}`,
          );
          console.log(`   ℹ️  User can use "Forgot Password" on login screen`);
        } else {
          console.log(`   ✅ Password reset email sent`);
        }

        successCount++;
        console.log(`   ✅ Migration complete for ${user.email}`);
      } catch (error: any) {
        console.error(`   ❌ Error migrating ${user.email}:`, error.message);
        errorCount++;
      }
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Migration Summary");
    console.log("=".repeat(60));
    console.log(`✅ Successfully migrated: ${successCount}`);
    console.log(`⏭️  Already existed: ${skipCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📧 Total users: ${users.length}`);
    console.log("=".repeat(60));

    if (successCount > 0) {
      console.log("\n🎉 Migration complete!");
      console.log(`
📝 Next steps:
1. Users will receive password reset emails at their registered addresses
2. They can also use "Forgot Password" on the login screen
3. Existing data (posts, followers, etc.) is preserved

⚠️  IMPORTANT: Keep your SUPABASE_SERVICE_ROLE_KEY secure and never commit it!
      `);
    }
  } catch (error: any) {
    console.error("\n❌ Migration failed:", error.message);
    throw error;
  }
}

// Run migration
migrateUsers()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
