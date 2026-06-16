# 🚀 Deployment Checklist: Background Call Notifications

**Follow these steps in order to deploy background call notifications to production.**

---

## Pre-Deployment Verification

- [ ] Code compiles: `npx tsc --noEmit`
- [ ] All changes committed to git
- [ ] Current branch: `main`

---

## Step 1: Database Migration

### 1.1 Apply Migration to Production

```bash
# Push migration to Supabase production
supabase db push --project-ref npfjanxturvmjyevoyfo
```

### 1.2 Set Required App Settings

**⚠️ CRITICAL:** The trigger uses `pg_net` to call the Edge Function. You MUST set these app-level settings:

```sql
-- In Supabase SQL Editor (production database)
-- Replace <SERVICE_ROLE_KEY> with actual key from Supabase Dashboard → Settings → API

ALTER DATABASE postgres SET app.supabase_url = 'https://npfjanxturvmjyevoyfo.supabase.co';
ALTER DATABASE postgres SET app.supabase_service_key = '<SERVICE_ROLE_KEY>';
```

### 1.3 Verify Trigger Exists

```sql
-- In Supabase SQL Editor
SELECT * FROM pg_trigger WHERE tgname = 'call_signals_push_trigger';
-- Should return 1 row
```

---

## Step 2: Deploy Edge Function

```bash
# Deploy send_notification Edge Function with --no-verify-jwt
supabase functions deploy send_notification --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
```

**Verify deployment:**
- Go to Supabase Dashboard → Edge Functions → send_notification
- Status should be "Deployed"
- No errors in logs

---

## Step 3: Deploy Mobile App

### 3.1 Commit Changes

```bash
git add -A
git commit -m "feat(calls): background call notifications via push"
git push origin main
```

### 3.2 Deploy OTA Update

**⚠️ REQUIRED:** OTA update is mandatory for all JavaScript changes.

```bash
npx eas-cli update --branch production --platform ios --message "feat: background call notifications"
```

**Verify OTA update:**
- Go to https://expo.dev → Updates
- Check that the update appears in the "production" branch
- Status should be "published"

### 3.3 Native Build (Only if Needed)

**Only required if:**
- iOS entitlements changed (e.g., added VoIP push)
- Native dependencies changed (new packages with native code)

```bash
npx eas-cli build --platform ios --profile production --auto-submit --non-interactive
```

**For this feature:** Native build is NOT required unless you add VoIP push certificate.

---

## Step 4: TestFlight Distribution

### 4.1 Force Users to Download OTA Update

**Users MUST force-close the app twice:**

1. **First close:** Downloads the OTA update in background
2. **Second close + reopen:** Applies the update

**Instruct TestFlight users:**

> "A new update is available. Please force-close the DVNT app TWICE (swipe up from app switcher), then reopen the app."

### 4.2 Verify Update Applied

Check logs on device:
```
[ProtectedLayout] Push token registered: ExponentPushToken[...]
[ProtectedLayout] Push token saved to backend
[NotificationListener] Notification listener mounted
```

---

## Step 5: Test on 2 Devices

### 5.1 Prerequisites

- [ ] Both devices on **production build** (TestFlight)
- [ ] Both devices **force-closed twice** to apply OTA
- [ ] Both devices have **notifications enabled** (Settings → DVNT → Notifications)
- [ ] Both devices logged into **different accounts**

### 5.2 Test: App in Background

**Phone A:**
1. Open DVNT app, start video call to Phone B
2. Wait for "Calling..." screen

**Phone B:**
1. Press home button (app in background)
2. **Expected:** Native call UI appears (CallKit/ConnectionService)
3. **If fails:** Check device logs for "[NotificationListener]" errors

### 5.3 Test: App Killed

**Phone A:**
1. Open DVNT app, start call to Phone B

**Phone B:**
1. Force-close DVNT app (swipe up from app switcher)
2. **Expected:** Lock screen notification appears "User A is calling..."
3. Tap notification → app opens → native call UI appears
4. **If fails:** Check push token saved (`push_tokens` table)

### 5.4 Test: App in Foreground

**Phone A:**
1. Start call to Phone B

**Phone B:**
1. Keep app in foreground
2. **Expected:** Single native call UI (no duplicate)
3. **If fails:** Check logs for "[CallSignals] Duplicate signal for room"

---

## Step 6: Monitor Production

### 6.1 Database Trigger

Check if trigger is firing:

```sql
-- In Supabase SQL Editor
SELECT * FROM net.http_request_queue
WHERE url LIKE '%send_notification%'
ORDER BY created_at DESC
LIMIT 10;
```

**Expected:** Rows appear when calls are created.

### 6.2 Edge Function Logs

- Go to Supabase Dashboard → Edge Functions → send_notification → Logs
- **Expected:** `[send_notification] Sending call notification to user X`

### 6.3 Push Token Registration

Check users have push tokens:

```sql
-- In Supabase SQL Editor
SELECT user_id, platform, created_at, updated_at
FROM push_tokens
ORDER BY updated_at DESC
LIMIT 20;
```

**Expected:** Rows for active users (added after OTA update applied).

### 6.4 Push Delivery

- Go to https://expo.dev/notifications
- View sent notifications, delivery status
- **Expected:** "delivered" status for active devices

---

## Rollback Plan

If background calls fail after deployment:

### Option 1: Disable Trigger (Keep Push Functionality)

```sql
-- In Supabase SQL Editor
DROP TRIGGER IF EXISTS call_signals_push_trigger ON public.call_signals;
```

**Effect:** Realtime-only (app must be running), but no crashes.

### Option 2: Revert OTA Update

```bash
# Revert to previous update
npx eas-cli update --branch production --message "revert: background calls" --platform ios --auto
```

**Effect:** Users get previous code on next force-close.

### Option 3: Emergency Native Build

If OTA update causes crashes, submit emergency build:

```bash
npx eas-cli build --platform ios --profile production --auto-submit --non-interactive
```

**Timeline:** 1-2 hours for App Store review (if emergency flag set).

---

## Success Criteria

✅ **All these must pass:**

- [ ] Database trigger exists and fires on `call_signals` INSERT
- [ ] Edge Function receives requests and sends push notifications
- [ ] Users' push tokens saved to `push_tokens` table
- [ ] App in background → native call UI appears
- [ ] App killed → notification appears, tap opens app + call UI
- [ ] App in foreground → single call UI (no duplicate)
- [ ] No crashes, no ghost calls, no infinite loops

---

## Troubleshooting

### Push token not saved

**Symptom:** `push_tokens` table empty after OTA update

**Fix:**
1. Check logs: `[ProtectedLayout] Push token registered`
2. If missing, user needs to log out + log back in
3. Or uninstall + reinstall app

### Trigger not firing

**Symptom:** No rows in `net.http_request_queue`

**Fix:**
1. Check `pg_net` extension enabled: `SELECT * FROM pg_extension WHERE extname = 'pg_net'`
2. Check app settings: `SELECT current_setting('app.supabase_url')`
3. Re-run `ALTER DATABASE postgres SET ...` from Step 1.2

### Edge Function not sending push

**Symptom:** Trigger fires, but no push notifications sent

**Fix:**
1. Check Edge Function logs for errors
2. Verify `send_notification` deployed with `--no-verify-jwt`
3. Redeploy: `supabase functions deploy send_notification --no-verify-jwt`

### Notification arrives but CallKeep doesn't show

**Symptom:** Notification received, but no native call UI

**Fix:**
1. Check `[NotificationListener]` logs for errors
2. Verify CallKeep setup: `CT.dump()` shows "setupComplete"
3. Ensure `<NotificationListener />` mounted in `_layout.tsx`

---

## Post-Deployment

- [ ] Announce in TestFlight release notes: "Incoming calls now ring even when app is backgrounded"
- [ ] Monitor Edge Function logs for 24 hours
- [ ] Monitor push notification delivery rate
- [ ] Collect user feedback on call reliability

---

## Next Steps (Future)

**iOS VoIP Push** (true background wake without notification tap):

1. Add VoIP push certificate in Apple Developer Portal
2. Enable VoIP background mode in app.json
3. Replace `expo-notifications` with native PushKit
4. Update Edge Function to send VoIP push instead of regular APNS

**Estimated effort:** 1-2 days
