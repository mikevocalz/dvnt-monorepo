# User Migration to Supabase Auth

## ⚠️ IMPORTANT: Get Your Service Role Key First

Before running the migration, you need your Supabase Service Role Key:

1. Go to: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/settings/api
2. Find the **"service_role"** key (NOT the anon key)
3. Copy it (it's long, starts with "eyJ...")
4. Add it to your `.env` file:

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

⚠️ **NEVER commit this key to git! It has admin access to your database.**

---

## Running the Migration

### Step 1: Install dependencies (if needed)
```bash
pnpm add -D tsx dotenv
```

### Step 2: Add Service Role Key to .env
Add this line to your `.env` file:
```
SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key
```

### Step 3: Run the migration
```bash
npx tsx scripts/migrate-users-to-supabase-auth.ts
```

---

## What This Does

✅ **Preserves all existing data:**
- User profiles
- Posts, stories, events
- Followers, likes, comments
- All relationships

✅ **Creates Supabase Auth accounts** for each user with:
- Their email
- A temporary password
- Auto-confirmed email
- Username and name in metadata

✅ **Sends password reset emails** so users can set their own password

---

## After Migration

1. **You can login** with `mikefacesny@gmail.com`
2. **Check your email** for password reset link
3. **OR** use "Forgot Password" on login screen
4. **All other users** will also receive reset emails

---

## If Something Goes Wrong

The script is **idempotent** - you can run it multiple times safely. It will:
- Skip users that already exist in Supabase Auth
- Not duplicate any data
- Continue processing even if one user fails

---

## Testing

After migration:
1. Try logging in with: `mikefacesny@gmail.com`
2. Check if you see all your posts and data
3. Verify followers, likes, etc. are intact
