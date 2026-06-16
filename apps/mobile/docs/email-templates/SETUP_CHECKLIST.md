# 📧 Email Templates Setup Checklist

## ✅ Quick Setup (5 minutes)

### Step 1: Password Reset Email
- [ ] Go to [Supabase Auth Templates](https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/auth/templates)
- [ ] Click **"Reset Password"** template
- [ ] Copy content from `password-reset.html`
- [ ] Paste into HTML editor
- [ ] Click **Save**

### Step 2: Welcome/Confirmation Email
- [ ] Click **"Confirm Signup"** template
- [ ] Choose either:
  - `welcome-email.html` (full featured with intro)
  - `email-confirmation.html` (simple verification)
- [ ] Paste and Save

### Step 3: Add Redirect URL
- [ ] Go to [URL Configuration](https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/auth/url-configuration)
- [ ] Add redirect URL: `dvnt://reset-password`
- [ ] Click **Save**

### Step 4: Test It!
- [ ] Run your app: `pnpm start`
- [ ] Tap "Forgot Password" on login
- [ ] Enter your email
- [ ] Check inbox - should see beautiful template! 🎨
- [ ] Click link - should open app

---

## 🎨 Customization (Optional)

### Update Brand Colors
Find and replace in all templates:
```html
<!-- Primary purple -->
#8a40cf → your-color-here

<!-- Secondary purple -->
#6b21a8 → your-color-here
```

### Add Your Logo Image
Replace text logo with image:
```html
<!-- Replace: -->
<div class="logo">DVNT</div>

<!-- With: -->
<img src="https://your-cdn.com/logo.png" alt="DVNT" style="height: 40px;">
```

### Update Footer Links
```html
<a href="https://dvnt.app/help">Help Center</a>
<a href="https://dvnt.app/privacy">Privacy Policy</a>
<a href="https://dvnt.app/terms">Terms of Service</a>
```

---

## 📋 Template Files

```
docs/email-templates/
├── README.md                    ← Full documentation
├── SETUP_CHECKLIST.md          ← This file
├── password-reset.html         ← For password reset
├── password-reset-plain.txt    ← Plain text fallback
├── welcome-email.html          ← New user welcome
├── email-confirmation.html     ← Simple email verify
└── password-changed.html       ← Security notification
```

---

## 🚀 After Setup

Once configured, your users will receive:
- ✅ Beautiful branded emails
- ✅ Consistent dark theme design
- ✅ Mobile-responsive layouts
- ✅ Professional appearance
- ✅ Clear call-to-action buttons

---

## 📧 Supabase Template Variables

Available in all Supabase email templates:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{ .ConfirmationURL }}` | Magic link/reset URL | `dvnt://reset-password?token=...` |
| `{{ .Token }}` | Raw token string | `abc123...` |
| `{{ .TokenHash }}` | Hashed token | `xyz789...` |
| `{{ .Email }}` | User's email | `user@example.com` |
| `{{ .SiteURL }}` | Your site URL | `https://dvnt.app` |
| `{{ .RedirectTo }}` | Redirect URL | Set via `redirectTo` param |

---

## ✅ Verification

After setup, verify:
- [ ] Password reset email looks correct
- [ ] Deep link opens app (not browser)
- [ ] Reset password screen appears
- [ ] Can successfully reset password
- [ ] Email confirmation works (for new signups)

---

**All done?** Your email game is now 🔥! Users will love the professional look.
