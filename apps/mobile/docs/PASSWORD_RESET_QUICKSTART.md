# 🚀 Password Reset - Quick Start

## ✅ What's Done

- ✅ Forgot Password screen created
- ✅ Reset Password screen created
- ✅ Deep link handler added to root layout
- ✅ "Forgot Password?" link added to login screen
- ✅ Email template is already correct

## 🔧 ONE Config Step Required

### Add Redirect URL to Supabase

1. Go to: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/auth/url-configuration

2. Scroll down to **"Redirect URLs"**

3. Add this URL:
   ```
   dvnt://reset-password
   ```

4. Click **Save**

**That's it!** 🎉

---

## 🧪 Test It

```bash
# 1. Run your app
pnpm start

# 2. On login screen, tap "Forgot Password"
# 3. Enter your email: mikefacesny@gmail.com
# 4. Check your email inbox
# 5. Click "Reset Password" link
# 6. App should open to reset password screen
# 7. Enter new password
# 8. You'll be redirected to login
```

---

## 📧 What the Email Looks Like

Your users will receive an email like this:

```
Subject: Reset Your Password

Reset Password

Follow this link to reset the password for your user:

[Reset Password] ← Clickable link
```

When they click the link:
- Opens your app via deep link (`dvnt://reset-password`)
- Shows reset password screen
- They enter new password
- Redirects to login

---

## 🔒 Security Features

✅ Links expire after 1 hour
✅ One-time use only
✅ Passwords hashed with bcrypt
✅ Rate limiting on reset requests

---

## 💡 After User Migration

Once you run the migration script (`migrate-users-to-supabase-auth.ts`):
- All existing users will get a reset email automatically
- Or they can use "Forgot Password" themselves
- No data will be lost

---

## 📱 Deep Link Testing

### Test manually (iOS):
```bash
xcrun simctl openurl booted "dvnt://reset-password"
```

### Test manually (Android):
```bash
adb shell am start -W -a android.intent.action.VIEW -d "dvnt://reset-password"
```

---

**Ready to configure that redirect URL?** It takes 30 seconds! 🚀
