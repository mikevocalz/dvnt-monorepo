# Password Reset Flow with Supabase in Expo

## ✅ What's Been Set Up

### 1. **Forgot Password Screen** (`app/(auth)/forgot-password.tsx`)
- User enters their email
- Sends reset link via Supabase
- Shows confirmation message

### 2. **Reset Password Screen** (`app/(auth)/reset-password.tsx`)
- Validates reset token
- Allows user to set new password
- Redirects to login after success

### 3. **Deep Linking**
- App scheme: `dvnt://`
- Reset link redirects to: `dvnt://reset-password`

### 4. **Login Screen Updated**
- Added "Forgot Password?" link

---

## 🔧 Configuration Needed in Supabase Dashboard

### ⚠️ CRITICAL: Configure Redirect URL First

**Before testing, you MUST add the redirect URL to Supabase:**

1. Go to: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/auth/url-configuration
2. Scroll to **Redirect URLs** section
3. Add: `dvnt://reset-password`
4. Click **Save**

Without this, the email will contain an HTTP link instead of your deep link!

---

### Step 1: Verify Email Template

1. Go to: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/auth/templates

2. **Reset Password Email Template** - Should look like:
   
   ```html
   <h2>Reset Password</h2>
   <p>Follow this link to reset the password for your user:</p>
   <p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
   ```
   
   **You're all set!** The `{{ .ConfirmationURL }}` will automatically use your redirect URL from Step 1.

---

## 📱 How It Works

### User Flow:

1. **User taps "Forgot Password"** on login screen
2. **Enters email** → Supabase sends reset email
3. **Clicks link in email** → Opens app via deep link (`dvnt://reset-password`)
4. **App handles deep link** → Opens reset password screen
5. **User enters new password** → Supabase updates password
6. **Redirects to login** → User can now sign in with new password

---

## 🧪 Testing

### Test the Flow:

```bash
# 1. Run your app
pnpm start

# 2. On login screen, tap "Forgot Password"
# 3. Enter: mikefacesny@gmail.com
# 4. Check your email for reset link
# 5. Click link → should open app and show reset screen
# 6. Enter new password
# 7. Should redirect to login
```

### Test Deep Link Manually (iOS):

```bash
xcrun simctl openurl booted "dvnt://reset-password"
```

### Test Deep Link Manually (Android):

```bash
adb shell am start -W -a android.intent.action.VIEW -d "dvnt://reset-password"
```

---

## 🎨 Customization

### Update Email Template in Supabase:

The default email template is basic. You can customize it:

1. Go to: Auth → Email Templates → Reset Password
2. Customize HTML with your branding
3. Make sure to keep the deep link: `dvnt://reset-password`

Example custom email:

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; }
    .button { 
      background: #8A40CF; 
      color: white; 
      padding: 12px 24px; 
      text-decoration: none; 
      border-radius: 8px;
    }
  </style>
</head>
<body>
  <h2>Reset Your DVNT Password</h2>
  <p>You requested to reset your password. Click the button below to continue:</p>
  <a href="dvnt://reset-password" class="button">Reset Password</a>
  <p>If you didn't request this, you can safely ignore this email.</p>
</body>
</html>
```

---

## 🔒 Security Notes

1. **Reset links expire** - Supabase tokens expire after 1 hour by default
2. **One-time use** - Each reset link can only be used once
3. **Secure storage** - Passwords are hashed with bcrypt
4. **Rate limiting** - Supabase has built-in rate limiting on reset emails

---

## 🐛 Troubleshooting

### Issue: Deep link doesn't open app

**Solution**: Make sure your app is built as a dev build, not Expo Go
```bash
npx expo run:ios
# or
npx expo run:android
```

### Issue: Email not received

**Check**:
1. Email is in spam folder
2. User exists in Supabase Auth
3. Email template is configured correctly in Supabase Dashboard

### Issue: Reset link expired

**Solution**: Request a new reset link. Links expire after 1 hour.

---

## 📝 Next Steps

1. ✅ Configure Supabase email template with deep link
2. ✅ Add redirect URLs to Supabase
3. ✅ Test the flow with a real email
4. ✅ Customize email template with your branding
