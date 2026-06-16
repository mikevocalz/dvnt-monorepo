/**
 * Create Apple Review Test User
 * 
 * This script creates a test user for Apple's App Review team.
 * Run with: npx tsx scripts/create-apple-test-user.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables:');
  console.error('- EXPO_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
  console.error('- SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗');
  console.error('\nYou need the service role key to create users. Get it from:');
  console.error('Supabase Dashboard → Settings → API → service_role key');
  process.exit(1);
}

// Admin client with service role key (can bypass RLS)
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Apple Review test credentials
const TEST_USER = {
  email: 'applereview@dvnt.app',
  password: 'AppleReview2026!',
  username: 'applereview',
  firstName: 'Apple',
  lastName: 'Review',
};

async function createTestUser() {
  console.log('Creating Apple Review test user...\n');

  // 1. Check if user already exists
  const { data: existingUser } = await supabase
    .from('users')
    .select('id, username, email')
    .eq('username', TEST_USER.username)
    .single();

  if (existingUser) {
    console.log('✓ Test user already exists:');
    console.log(`  Email: ${TEST_USER.email}`);
    console.log(`  Password: ${TEST_USER.password}`);
    console.log(`  Username: ${TEST_USER.username}`);
    return;
  }

  // 2. Create auth user
  console.log('Creating auth user...');
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    email_confirm: true, // Skip email verification
    user_metadata: {
      username: TEST_USER.username,
      name: `${TEST_USER.firstName} ${TEST_USER.lastName}`,
    },
  });

  if (authError) {
    console.error('Failed to create auth user:', authError.message);
    process.exit(1);
  }

  console.log('✓ Auth user created:', authData.user.id);

  // 3. Create user profile
  console.log('Creating user profile...');
  const { error: profileError } = await supabase.from('users').insert({
    auth_id: authData.user.id,
    email: TEST_USER.email,
    username: TEST_USER.username,
    first_name: TEST_USER.firstName,
    last_name: TEST_USER.lastName,
    followers_count: 0,
    following_count: 0,
    posts_count: 0,
    verified: false,
    is_private: false,
  });

  if (profileError) {
    console.error('Failed to create profile:', profileError.message);
    // Clean up auth user
    await supabase.auth.admin.deleteUser(authData.user.id);
    process.exit(1);
  }

  console.log('✓ User profile created\n');

  console.log('═══════════════════════════════════════════');
  console.log('  APPLE REVIEW TEST CREDENTIALS');
  console.log('═══════════════════════════════════════════');
  console.log(`  Email:    ${TEST_USER.email}`);
  console.log(`  Password: ${TEST_USER.password}`);
  console.log(`  Username: ${TEST_USER.username}`);
  console.log('═══════════════════════════════════════════\n');
  console.log('Add these credentials to App Store Connect:');
  console.log('App Store Connect → Your App → App Review Information');
}

createTestUser().catch(console.error);
