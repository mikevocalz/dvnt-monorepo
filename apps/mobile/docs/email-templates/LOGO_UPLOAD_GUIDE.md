# 📸 Upload DVNT Logo for Email Templates

## 🚨 Quick Start: Create the Bucket First!

The email templates reference your logo at:
```
https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/public/assets/dvnt-logo-white.png
```

But this won't work until you create the `assets` bucket and upload your logo.

---

## Step 1: Create Public Assets Bucket

1. **Go to Storage**: https://supabase.com/dashboard/project/npfjanxturvmjyevoyfo/storage/buckets

2. **Click "New bucket"**

3. **Configure**:
   - Name: `assets`
   - ✅ Check **"Public bucket"** (IMPORTANT!)
   - Click **Create bucket**

---

## Step 2: Upload Your Logo

### Option A: Use Existing Icon (Recommended)

1. Find your logo at: `assets/images/icon.png`
2. This is your app icon - it should work for emails

### Option B: Create White Version (Better for Purple Header)

If your icon has dark colors:
1. Open `icon.png` in any image editor
2. Make a white/light version
3. Save as PNG with transparent background

### Upload Steps:

1. **Click on `assets` bucket**
2. **Click "Upload file"**
3. **Select** your logo file
4. **Rename** to: `dvnt-logo-white.png`
5. **Click Upload**

---

## Step 3: Verify It Works

After upload, test the URL in your browser:
```
https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/public/assets/dvnt-logo-white.png
```

You should see your logo! ✅

---

## 💡 Quick Tips

**Logo Size:**
- Recommended: 300x300px or larger
- Format: PNG with transparent background
- File size: Under 100KB for fast email loading

**Color:**
- White/light colored for purple gradient header
- Your current icon should work fine

---

## 🔄 Alternative: Use a Different URL

Don't want to use Supabase Storage? No problem!

1. Upload your logo anywhere (Cloudflare, AWS S3, etc.)
2. Get the public URL
3. Replace this line in all email templates:

```html
<!-- Find: -->
<img src="https://npfjanxturvmjyevoyfo.supabase.co/storage/v1/object/public/assets/dvnt-logo-white.png" alt="DVNT" class="logo-image" />

<!-- Replace with: -->
<img src="YOUR_LOGO_URL_HERE" alt="DVNT" class="logo-image" />
```

---

## ✅ After Upload

Once your logo is uploaded:

1. ✅ Bucket created (`assets`, public)
2. ✅ Logo uploaded (`dvnt-logo-white.png`)
3. ✅ URL works (test in browser)
4. ✅ Copy email template to Supabase Dashboard

**Your emails will now have your logo!** 🎉
