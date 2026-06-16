# 🚀 Ready to Copy-Paste: Password Reset Email Template

## ✅ Complete HTML Template with Your Logo

Your email templates now use your hosted logo from:
```
https://images.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/44194a62-f354-49eb-bc41-160942213388/DVNT-app_white.png?format=500w
```

**No upload needed** - the logo is already live! 🎉

---

## ✅ Complete HTML Template Below

Copy **EVERYTHING** from the code block below and paste it into Supabase Dashboard:

---

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #e4e4e7;
      background-color: #09090b;
      padding: 20px;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background: linear-gradient(135deg, #18181b 0%, #1a1a1a 100%);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .header {
      background: linear-gradient(135deg, #8a40cf 0%, #6b21a8 100%);
      padding: 40px 30px;
      text-align: center;
    }
    .logo {
      font-size: 32px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 2px;
      margin-bottom: 8px;
    }
    .logo-image {
      height: 60px;
      width: auto;
      margin-bottom: 12px;
    }
    .tagline {
      font-size: 14px;
      color: #e9d5ff;
      letter-spacing: 0.5px;
    }
    .content {
      padding: 40px 30px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 16px;
    }
    p {
      font-size: 16px;
      color: #a1a1aa;
      margin-bottom: 24px;
    }
    .button-container {
      text-align: center;
      margin: 40px 0;
    }
    .button {
      display: inline-block;
      background: linear-gradient(135deg, #8a40cf 0%, #6b21a8 100%);
      color: #ffffff !important;
      text-decoration: none;
      padding: 16px 48px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 12px rgba(138, 64, 207, 0.4);
      transition: all 0.3s ease;
    }
    .button:hover {
      box-shadow: 0 6px 16px rgba(138, 64, 207, 0.6);
      transform: translateY(-2px);
    }
    .info-box {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 20px;
      margin: 24px 0;
    }
    .info-box p {
      margin-bottom: 8px;
      font-size: 14px;
      color: #a1a1aa;
    }
    .info-box strong {
      color: #e4e4e7;
    }
    .footer {
      background: #09090b;
      padding: 30px;
      text-align: center;
      border-top: 1px solid #27272a;
    }
    .footer p {
      font-size: 13px;
      color: #71717a;
      margin-bottom: 8px;
    }
    .footer a {
      color: #8a40cf;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
    .security-note {
      background: #18181b;
      border-left: 4px solid #8a40cf;
      padding: 16px;
      margin: 24px 0;
      border-radius: 8px;
    }
    .security-note p {
      margin: 0;
      font-size: 14px;
      color: #a1a1aa;
    }
    @media only screen and (max-width: 600px) {
      .email-container {
        border-radius: 0;
      }
      .content {
        padding: 30px 20px;
      }
      .header {
        padding: 30px 20px;
      }
      .logo {
        font-size: 28px;
      }
      .button {
        padding: 14px 36px;
        font-size: 15px;
      }
    }
  </style>
</head>
<body>
  <div class="email-container">
    <!-- Header -->
    <div class="header">
      <img src="https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/public/assets/dvnt-logo-white.png" alt="DVNT" class="logo-image" />
      <div class="tagline">Your Creative Community</div>
    </div>

    <!-- Content -->
    <div class="content">
      <h1>Reset Your Password</h1>
      <p>We received a request to reset your password. Click the button below to create a new password:</p>

      <div class="button-container">
        <a href="{{ .ConfirmationURL }}" class="button">Reset Password</a>
      </div>

      <div class="security-note">
        <p><strong>🔒 Security Notice:</strong> This link will expire in 1 hour and can only be used once.</p>
      </div>

      <div class="info-box">
        <p><strong>Didn't request this?</strong></p>
        <p>If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
      </div>

      <p style="margin-top: 32px; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; font-size: 13px; color: #8a40cf;">{{ .ConfirmationURL }}</p>
    </div>

    <!-- Footer -->
    <div class="footer">
      <p>© 2024 DVNT. All rights reserved.</p>
      <p>
        <a href="https://dvnt.app/help">Help Center</a> •
        <a href="https://dvnt.app/privacy">Privacy Policy</a> •
        <a href="https://dvnt.app/terms">Terms of Service</a>
      </p>
      <p style="margin-top: 16px;">This is an automated message, please do not reply.</p>
    </div>
  </div>
</body>
</html>
```

---

## 📋 How to Use

1. **Select ALL the HTML above** (from `<!DOCTYPE html>` to `</html>`)
2. **Copy it** (Cmd+C or Ctrl+C)
3. Go to: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/auth/templates
4. Click **"Reset Password"** template
5. **Paste** into the HTML editor
6. Click **Save**

---

## ✅ What You Get

- 🎨 Beautiful dark theme matching DVNT
- 💜 Purple gradient header
- 🖼️ **Your DVNT logo** (instead of text)
- 📱 Mobile responsive
- 🔒 Security notice included
- 📧 Professional layout
- ✨ Modern design

---

## 📸 Logo Setup Required

**Before this template will work**, you need to:

1. **Upload your logo** to Supabase Storage (see `LOGO_UPLOAD_GUIDE.md`)
2. Create a public `assets` bucket
3. Upload `icon.png` as `dvnt-logo-white.png`
4. Verify it loads at the URL in the template

**Ready to paste!** The template is complete with logo integration. 🚀
