# 📱 Background Call Notifications

This document explains how incoming calls work when the app is backgrounded or killed.

---

## Architecture

### Problem

Without push notifications, incoming calls only ring when:
- App is in foreground AND
- Supabase Realtime subscription is active

When the app is backgrounded/killed, the Realtime connection closes, so calls don't ring.

### Solution

**Database Trigger → Push Notification → CallKeep UI**

```
┌─────────────────┐
│  call_signals   │
│  INSERT ringing │
└────────┬────────┘
         │
         │ Database Trigger
         ▼
┌─────────────────────────┐
│ send_notification Edge  │
│ Function (high priority)│
└────────┬────────────────┘
         │
         │ Expo Push Service
         ▼
┌─────────────────────────┐
│  User's Device (iOS/    │
│  Android) - WAKES APP   │
└────────┬────────────────┘
         │
         │ NotificationListener
         ▼
┌─────────────────────────┐
│ CallKeep.displayIncoming│
│ Call() → Native Call UI │
└─────────────────────────┘
```

---

## Components

### 1. Database Trigger

**File:** `supabase/migrations/20260210_call_signals_push_trigger.sql`

- Fires on `call_signals` INSERT with `status='ringing'`
- Calls `send_notification` Edge Function via `pg_net.http_post`
- Passes call metadata: caller info, room ID, call type

### 2. Edge Function

**File:** `supabase/functions/send_notification/index.ts`

- Accepts `type: "call"` notifications
- Uses **high priority** for iOS/Android wake
- Creates Expo push message with:
  - `priority: "high"` (Android heads-up notification)
  - `channelId: "calls"` (Android high-importance channel)
  - `categoryId: "CALL"` (iOS notification category)
- Skips storing in `notifications` table (calls are transient)

### 3. Mobile App

**Push Registration:** `app/(protected)/_layout.tsx`
- Calls `registerForPushNotificationsAsync()` on mount
- Saves token to `push_tokens` table (keyed by user_id)

**Notification Handler:** `lib/notifications.ts`
- Configures `expo-notifications` handler
- Creates high-priority "calls" channel on Android
- Shows alert + sound for incoming calls

**Listener:** `src/services/callkeep/NotificationListener.tsx`
- Mounted in protected layout (always active when authenticated)
- Handles `type: "call"` push notifications
- Calls `CallKeep.displayIncomingCall()` to show native UI
- Dedupes with Realtime to prevent double UI

**Coordinator:** `src/services/callkeep/useCallKeepCoordinator.ts`
- Handles answer/decline events from CallKeep
- Already handles both Realtime + Push-triggered calls
- No changes needed (works with both flows)

---

## Deployment

### 1. Database Setup

Run the migration to create the trigger:

```bash
# Apply migration locally (optional)
supabase migration up

# Push to remote (production)
supabase db push
```

**⚠️ CRITICAL:** Set app settings for `pg_net`:

```sql
-- In Supabase SQL Editor (production database)
ALTER DATABASE postgres SET app.supabase_url = 'https://npfjanxturvmjyevoyfo.supabase.co';
ALTER DATABASE postgres SET app.supabase_service_key = '<SERVICE_ROLE_KEY>';
```

Without these settings, the `pg_net.http_post` call will fail.

### 2. Edge Function Deployment

Deploy the updated `send_notification` Edge Function:

```bash
supabase functions deploy send_notification --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
```

### 3. Mobile App Deployment

Push OTA update to production:

```bash
# 1. Commit changes
git add -A
git commit -m "feat(calls): background call notifications via push"
git push origin main

# 2. Deploy OTA update (REQUIRED for all JS changes)
npx eas-cli update --branch production --platform ios --message "feat: background call notifications"

# 3. (Optional) Native build if iOS entitlements changed
# Only needed if you add VoIP push certificate or other native changes
npx eas-cli build --platform ios --profile production --auto-submit --non-interactive
```

**Force-close app twice** on TestFlight to download + apply OTA update.

### 4. iOS VoIP Push (Optional - Future Enhancement)

For true VoIP push on iOS (calls ring even when killed without notification tap):

1. **Apple Developer Portal:**
   - Enable "Push Notifications" capability
   - Create VoIP push certificate
   - Download and upload to Expo

2. **app.json:**
   ```json
   {
     "expo": {
       "ios": {
         "infoPlist": {
           "UIBackgroundModes": ["voip"]
         }
       }
     }
   }
   ```

3. **Replace Expo push with native PushKit** (significant work)

**For now:** High-priority FCM/APNS push is sufficient — calls ring reliably when app is backgrounded, and show notification when killed.

---

## Testing

### Scenario 1: App in Foreground

**Expected:** Realtime + Push both trigger, dedupe prevents double UI

1. User A starts call to User B
2. User B's app is in foreground
3. **Realtime:** `useCallKeepCoordinator` receives signal, calls `showIncomingCall()`
4. **Push:** Arrives ~1-2s later, `NotificationListener` dedupes (room ID already seen)
5. **Result:** Single CallKeep UI, no duplicate

### Scenario 2: App in Background

**Expected:** Push wakes app, triggers CallKeep

1. User A starts call to User B
2. User B's app is backgrounded (home screen)
3. **Realtime:** Disconnected (subscription inactive)
4. **Push:** Arrives via FCM/APNS, wakes app
5. `NotificationListener` fires, calls `showIncomingCall()`
6. **Result:** Native call UI appears

### Scenario 3: App Killed

**Expected:** Notification shown, tap opens app + triggers CallKeep

1. User A starts call to User B
2. User B's app is killed (force-closed)
3. **Realtime:** Not running
4. **Push:** Notification appears on lock screen
5. User B taps notification → app opens
6. `NotificationListener` fires, calls `showIncomingCall()`
7. **Result:** App opens to call screen, CallKeep UI appears

### Debug Logs

Check `CallTrace` logs for push notification flow:

```javascript
// In dev console or device logs
CT.dump().filter(e => e.category === 'PUSH')

// Expected events:
// - PUSH: notificationListener_mounted
// - PUSH: foreground_call_notification / background_call_notification
// - PUSH: displaying_callkeep_from_push
```

---

## Troubleshooting

### Calls don't ring when app is backgrounded

**Possible causes:**

1. **Push token not saved**
   - Check: Query `push_tokens` table for user's token
   - Fix: Ensure `registerForPushNotificationsAsync()` runs on login
   - Verify: Log in `_layout.tsx` shows "Push token registered"

2. **Database trigger not firing**
   - Check: `pg_net` extension enabled (`SELECT * FROM pg_extension WHERE extname = 'pg_net'`)
   - Check: App settings set (`SELECT current_setting('app.supabase_url')`)
   - Fix: Run `ALTER DATABASE postgres SET app.supabase_url = '...'`

3. **Edge Function not sending push**
   - Check: Edge Function logs in Supabase Dashboard
   - Check: Expo push notification status (https://expo.dev/notifications)
   - Fix: Redeploy Edge Function with `--no-verify-jwt`

4. **Notification permissions denied**
   - Check: Device Settings → DVNT → Notifications → Allowed
   - Fix: Uninstall/reinstall app, grant permissions on first launch

### Push arrives but CallKeep doesn't show

**Possible causes:**

1. **NotificationListener not mounted**
   - Check: `CT.dump()` shows "notificationListener_mounted"
   - Fix: Ensure `<NotificationListener />` in `_layout.tsx`

2. **CallKeep not set up**
   - Check: `CT.dump()` shows "setupComplete"
   - Fix: Ensure `useCallKeepCoordinator()` runs before NotificationListener

3. **Duplicate call UI prevented**
   - Check: Logs show "call_notification_duplicate_ignored"
   - This is expected — Realtime already showed the UI

### iOS: App doesn't wake from killed state

**Expected behavior:** Notification shown, requires tap to open app

iOS does NOT support background wake from killed state without VoIP push certificate. High-priority APNS push shows notification on lock screen, which user must tap.

**To enable true VoIP wake:**
- Add VoIP push certificate (see "iOS VoIP Push" section above)
- Switch to PushKit instead of expo-notifications

---

## Monitoring

### Database Trigger

Check if trigger fired:

```sql
-- Query pg_net requests (if enabled)
SELECT * FROM net.http_request_queue
WHERE url LIKE '%send_notification%'
ORDER BY created_at DESC
LIMIT 10;
```

### Edge Function

Check logs in Supabase Dashboard:
- Functions → send_notification → Logs
- Look for: `[send_notification] Sending call notification to user X`

### Push Delivery

Check Expo push notification status:
- https://expo.dev/notifications
- View sent notifications, delivery status, errors

### Device Logs

iOS:
```bash
xcrun simctl spawn booted log stream --predicate 'subsystem contains "expo"' --level debug
```

Android:
```bash
adb logcat -s ReactNativeJS:V expo:V
```

---

## Summary

✅ **Done:**
- Database trigger sends push on `call_signals` INSERT
- Edge Function handles `type: "call"` with high priority
- Mobile app registers for push + saves token
- NotificationListener displays CallKeep UI on push
- Deduplication prevents double UI from Realtime + Push

✅ **Works:**
- App in foreground → Realtime + Push (deduped)
- App in background → Push wakes app
- App killed → Notification shown, tap opens app

⏳ **Future (iOS VoIP):**
- Add VoIP push certificate
- Replace expo-notifications with PushKit
- Enable true background wake (no notification tap needed)
