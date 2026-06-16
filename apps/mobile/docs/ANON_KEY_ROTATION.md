# Supabase Anon Key Rotation Procedure (SEC-03)

The Supabase anon key (`EXPO_PUBLIC_SUPABASE_ANON_KEY`) is bundled into the client app. If it is compromised or needs rotation, follow this procedure.

## When to Rotate

- Anon key leaked to a public repo or unauthorized party
- Periodic rotation per security policy
- Suspected abuse of the anon key

## Pre-Rotation Checklist

- [ ] Confirm all RLS policies are enforced (anon key should only grant scoped reads)
- [ ] Confirm edge functions use `SUPABASE_SERVICE_ROLE_KEY` (not anon key) for writes
- [ ] Note the current anon key value for rollback

## Rotation Steps

### 1. Generate New Key in Supabase Dashboard

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/settings/api)
2. Navigate to **Settings → API**
3. Click **Regenerate anon key** (or create a new one via the JWT tool if available)
4. Copy the new key

> **Warning:** The old key is invalidated immediately. All active clients using the old key will start getting 401 errors.

### 2. Update Environment Variables

```bash
# Local development
# .env
EXPO_PUBLIC_SUPABASE_ANON_KEY=<new-key>

# EAS Build secrets
eas secret:push --env-file .env --scope project

# Supabase Edge Function secrets (edge functions that reference it)
supabase secrets set SUPABASE_ANON_KEY=<new-key>
```

### 3. Deploy Updated App

```bash
# OTA update (fastest — reaches existing installs)
eas update --channel production --message "Rotate anon key"

# Native build (for new installs)
eas build --platform ios --profile production
```

### 4. Verify

```bash
# Check auth endpoint
curl -H "apikey: <new-key>" \
  https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth/api/auth/ok

# Check a public read
curl -H "apikey: <new-key>" \
  "https://npfjanxturvmjyevoyfo.supabase.co/rest/v1/posts?select=id&limit=1"
```

### 5. Monitor

- Watch Supabase logs for 401 errors from old key usage
- Check EAS update adoption rate to confirm clients are picking up the new key
- Old native builds (not yet updated) will be broken until they receive the OTA update

## Rollback

If the new key causes issues:
1. Regenerate the key again in Supabase Dashboard
2. Push another OTA update with the corrected key

## Notes

- The anon key is **not secret** — it's designed to be public. RLS policies are the security boundary.
- The service role key (`SUPABASE_SERVICE_ROLE_KEY`) is the real secret and should **never** be rotated without coordinating with all edge functions.
- After rotation, force-close and reopen the app to pick up the OTA update.
