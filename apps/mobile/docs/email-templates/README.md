# Email Templates for DVNT

## 🎨 Available Templates

### 1. **Password Reset** (`password-reset.html`)
For users who request to reset their password.
- ✅ Purple gradient header with DVNT branding
- ✅ Clear "Reset Password" CTA button
- ✅ Security notice (1-hour expiration)
- ✅ "Didn't request this?" section

### 2. **Welcome Email** (`welcome-email.html`)
Sent to new users after registration.
- ✅ Warm welcome message with emoji
- ✅ Feature showcase (3 key features)
- ✅ Email verification CTA
- ✅ Onboarding-focused design

### 3. **Email Confirmation** (`email-confirmation.html`)
Simple email verification for new signups.
- ✅ Straightforward "Confirm Email" button
- ✅ 24-hour expiration notice
- ✅ Clean, minimal design

### 4. **Password Changed** (`password-changed.html`)
Security notification when password is updated.
- ✅ Success checkmark icon
- ✅ Account details displayed
- ✅ Security alert for unauthorized changes
- ✅ "Contact Support" CTA
- ✅ Security best practices list

---

## 🎨 Design Features

All templates share:
✅ **Modern Dark Theme** - Matches your DVNT app aesthetic
✅ **Purple Gradient Branding** - Your signature `#8a40cf` color
✅ **Responsive Design** - Looks great on mobile & desktop
✅ **Clear CTA Buttons** - Eye-catching calls-to-action
✅ **Professional Layout** - Polished gradient header with logo
✅ **Accessibility** - High contrast, readable fonts
✅ **Mobile-Optimized** - Responsive breakpoints for small screens

---

## 📋 How to Use in Supabase

### For Password Reset Email:
1. Go to: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/auth/templates
2. Click on **"Reset Password"** template
3. Select the **HTML editor** (not plain text)
4. Copy and paste all content from `password-reset.html`
5. Click **Save**

### For Email Confirmation:
1. Same dashboard, click **"Confirm Signup"** template
2. Paste content from `email-confirmation.html`
3. Save

### For Password Changed (Custom Email):
This is a security notification you'd send via your backend when a user successfully changes their password. You can trigger this using Supabase Edge Functions or your backend after a password update.

---

## 🎨 What They Look Like

### Password Reset Email
```
┌─────────────────────────────────────┐
│     [Purple Gradient Header]        │
│           DVNT                      │
│     Your Creative Community         │
├─────────────────────────────────────┤
│                                     │
│  Reset Your Password                │
│                                     │
│  We received a request to reset     │
│  your password...                   │
│                                     │
│    ┌─────────────────────┐         │
│    │  Reset Password  →  │  ← CTA  │
│    └─────────────────────┘         │
│                                     │
│  🔒 Expires in 1 hour               │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Didn't request this?        │   │
│  │ Safely ignore this email... │   │
│  └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│  © 2024 DVNT • Help • Privacy      │
└─────────────────────────────────────┘
```

### Welcome Email
```
┌─────────────────────────────────────┐
│     [Purple Gradient Header]        │
│           DVNT                      │
│     Your Creative Community         │
├─────────────────────────────────────┤
│                                     │
│  Welcome to DVNT! 🎉                │
│                                     │
│  We're excited to have you...       │
│                                     │
│    ┌─────────────────────┐         │
│    │  Verify Your Email  │  ← CTA  │
│    └─────────────────────┘         │
│                                     │
│  What You Can Do on DVNT            │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 📸 Share Your Story         │   │
│  │ Create posts, stories...    │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ 💬 Connect & Chat           │   │
│  │ Follow creators, engage...  │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ 🎫 Discover Events          │   │
│  │ Find exciting events...     │   │
│  └─────────────────────────────┘   │
│                                     │
├─────────────────────────────────────┤
│  © 2024 DVNT • Help • Privacy      │
└─────────────────────────────────────┘
```

### Password Changed (Security Alert)
```
┌─────────────────────────────────────┐
│     [Purple Gradient Header]        │
│              ✅                     │
│           DVNT                      │
├─────────────────────────────────────┤
│                                     │
│  Password Changed Successfully      │
│                                     │
│  Your password was recently         │
│  changed...                         │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Email: user@example.com     │   │
│  │ Changed: Just now           │   │
│  └─────────────────────────────┘   │
│                                     │
│  ⚠️ Didn't make this change?       │
│  Contact support immediately        │
│                                     │
│    ┌─────────────────────┐         │
│    │  Contact Support    │  ← CTA  │
│    └─────────────────────┘         │
│                                     │
├─────────────────────────────────────┤
│  © 2024 DVNT • Security Tips       │
└─────────────────────────────────────┘
```

---

## 🎨 Customization Options

### Update Colors

Find these lines in the HTML to change colors:

```html
<!-- Primary purple color -->
background: linear-gradient(135deg, #8a40cf 0%, #6b21a8 100%);

<!-- Dark background -->
background-color: #09090b;

<!-- Text color -->
color: #e4e4e7;
```

### Update Links

Find these lines in the footer:

```html
<a href="https://dvnt.app/help">Help Center</a>
<a href="https://dvnt.app/privacy">Privacy Policy</a>
<a href="https://dvnt.app/terms">Terms of Service</a>
```

Replace with your actual URLs when ready!

### Add Your Logo

To add an image logo instead of text:

```html
<!-- Replace this: -->
<div class="logo">DVNT</div>

<!-- With this: -->
<img src="https://your-cdn.com/logo.png" alt="DVNT" style="height: 40px;">
```

---

## 📧 Template Usage by Scenario

| Scenario | Template to Use | Supabase Setting |
|----------|----------------|------------------|
| User requests password reset | `password-reset.html` | Auth Templates → Reset Password |
| New user signs up | `welcome-email.html` | Auth Templates → Confirm Signup |
| Email verification only | `email-confirmation.html` | Auth Templates → Confirm Signup |
| Password successfully changed | `password-changed.html` | Custom (send via Edge Function) |
| Magic link login | Use `password-reset.html` as base | Auth Templates → Magic Link |

---

## 🧪 Testing the Templates

### Preview in Browser
1. Open any `.html` file in Chrome/Safari
2. Replace `{{ .ConfirmationURL }}` with: `https://dvnt.app/test`
3. Replace `{{ .Email }}` with: `test@example.com`
4. See how it looks!

### Send Test Email via Supabase
```bash
# After configuring in Supabase Dashboard
# In your app:
1. Tap "Forgot Password"
2. Enter your email
3. Check inbox - see the beautiful template! ✨
```

### Test in Real Email Clients
- **Gmail** - Dark mode support ✅
- **Apple Mail** - Native appearance ✅
- **Outlook** - Corporate-friendly ✅
- **Mobile** - Responsive design ✅

Use tools like:
- [Litmus](https://litmus.com) - Test across email clients
- [Email on Acid](https://www.emailonacid.com) - Email testing
- [Mailtrap](https://mailtrap.io) - Catch test emails

---

## 🔥 What Makes This Template Great

✅ **Inline CSS** - Works in all email clients
✅ **No External Dependencies** - Self-contained
✅ **Mobile-First** - Responsive breakpoints
✅ **Dark Mode Native** - Uses dark colors
✅ **High Deliverability** - Simple, clean code
✅ **Accessible** - Proper semantic HTML
✅ **Brand Consistent** - Matches your app

---

**Ready to use!** Just copy-paste into Supabase Dashboard. 🚀
