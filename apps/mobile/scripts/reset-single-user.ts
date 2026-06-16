import { createClient } from "@supabase/supabase-js";
// @ts-ignore - dotenv may not have types installed
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../.env") });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function resetPassword() {
  const email = "mikefacesny@gmail.com";
  const newPassword = "TempPassword123!";

  console.log(`🔐 Resetting password for: ${email}`);
  console.log(`🔑 New password: ${newPassword}`);
  console.log("");

  // Find user by email
  const {
    data: { users },
    error: listError,
  } = await adminSupabase.auth.admin.listUsers();

  if (listError) {
    console.error("❌ Error listing users:", listError);
    return;
  }

  const user = users?.find((u) => u.email === email);

  if (!user) {
    console.error("❌ User not found");
    return;
  }

  console.log(`✅ Found user: ${user.id}`);

  // Update password directly
  const { error: updateError } = await adminSupabase.auth.admin.updateUserById(
    user.id,
    { password: newPassword },
  );

  if (updateError) {
    console.error("❌ Error updating password:", updateError);
    return;
  }

  console.log("");
  console.log("✅ Password updated successfully!");
  console.log("");
  console.log("📱 You can now login with:");
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${newPassword}`);
  console.log("");
  console.log("⚠️  IMPORTANT: Change this password after logging in!");
}

resetPassword()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
