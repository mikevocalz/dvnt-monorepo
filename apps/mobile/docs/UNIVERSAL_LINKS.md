# Universal links — why `https://dvntapp.live/e/20` isn't opening the app

> TL;DR: The app config is correct. The **domain isn't serving** the
> AASA + assetlinks files that iOS and Android require to claim the
> domain, so shared links open in Safari/Chrome instead of the app.
> Deploy `public/.well-known/*` to `https://dvntapp.live/.well-known/`
> with the right `Content-Type` headers, replace the Android
> fingerprint placeholders, and ship a native build. Then every shared
> `https://dvntapp.live/…` link will open the app directly.

---

## 1 — What's wired correctly (you don't need to touch this)

| Piece | Location | Status |
|---|---|---|
| iOS associated domains | `app.config.js:65` — `applinks:dvntapp.live` + `applinks:www.dvntapp.live` | ✅ |
| Android intent filters | `app.config.js:87-96` — `https` + `dvntapp.live` host | ✅ |
| Custom scheme fallback | `app.config.js:292` — `scheme: "dvnt"` | ✅ |
| Expo Router handler | `app/+native-intent.tsx` — parses URL → routes | ✅ |
| Route registry | `lib/deep-linking/route-registry.ts:142` — `/e/:id` → `/(protected)/events/:id` | ✅ |
| Guest public route | `lib/deep-linking/link-engine.ts:165-174` — logged-out users land on `/(public)/events/:id` | ✅ |

Every `https://dvntapp.live/…` path you care about is already mapped:
`/e/:id`, `/events/:id`, `/u/:username`, `/p/:id`, `/post/:id`,
`/story/:id`, `/ticket/:id`, `/comments/:postId`, `/tickets/guest/:token`,
and ~a dozen more. See `lib/deep-linking/route-registry.ts` for the
full list.

---

## 2 — What's broken (you need to fix this)

### 2a. `dvntapp.live` must serve these two files

**iOS:** `https://dvntapp.live/.well-known/apple-app-site-association`
**Android:** `https://dvntapp.live/.well-known/assetlinks.json`

Both files already exist in this repo at `public/.well-known/` but this
is an Expo app, not a web host. Something has to serve `dvntapp.live`.
The file content is correct; the hosting is what's missing.

Requirements Apple/Google enforce:

| Requirement | Why |
|---|---|
| HTTPS only | Apple + Google refuse HTTP |
| No redirects | Apple refuses AASA served through any redirect (including `http→https` or apex→`www`) |
| `Content-Type: application/json` | Apple accepts `application/json` or `application/pkcs7-mime`. Google requires `application/json` |
| Path `/.well-known/apple-app-site-association` | Note: **no file extension** on iOS. Not `.json` |
| Accessible to Apple's CDN | Apple scrapes once and caches in `app-site-association.cdn-apple.com`. After you deploy, give it 30 min to index |

### 2b. `assetlinks.json` has placeholder fingerprints

```json
"sha256_cert_fingerprints": [
  "<DEBUG_SHA256_FINGERPRINT>",
  "<RELEASE_SHA256_FINGERPRINT>"
]
```

Replace these with the real SHA256 fingerprints from the signing
keystores. Get them via:

```bash
# Release fingerprint (Google Play App Signing)
npx eas credentials
# → pick Android → production → show credentials
# The fingerprint is displayed under "Key SHA256"

# If you're managing signing yourself:
keytool -list -v -keystore your-release-keystore.jks -alias your-alias | grep SHA256
```

**One build only ever has ONE fingerprint active at a time.** If you
ship with Play App Signing, use the "upload" AND the "app signing"
fingerprints (Play re-signs your APKs).

---

## 3 — How to deploy the `.well-known` files

Pick whichever hosting you use for `dvntapp.live`. This repo contains
a `vercel.json` pre-configured with the right rewrites + headers, so
if you host with Vercel you can literally `vercel deploy` from the
repo root and it Just Works.

### Option A — Vercel (simplest, matches the bundled `vercel.json`)

```bash
# First time:
npm i -g vercel
vercel link            # link to a Vercel project or create new
vercel --prod          # deploys `public/` as a static site with
                        # correct Content-Type headers for .well-known

# Point dvntapp.live → this Vercel project in the Vercel dashboard.
```

The included `vercel.json` explicitly sets `Content-Type: application/json`
and `X-Content-Type-Options: nosniff` on both files. Without that Vercel
may serve AASA as `text/html` which iOS will silently reject.

### Option B — Cloudflare Pages

Create a new Pages project pointing at this repo, output directory
`public/`. Then create `_headers`:

```
/.well-known/apple-app-site-association
  Content-Type: application/json
  X-Content-Type-Options: nosniff

/.well-known/assetlinks.json
  Content-Type: application/json
  X-Content-Type-Options: nosniff
```

### Option C — Netlify

Create `netlify.toml`:

```toml
[[headers]]
  for = "/.well-known/apple-app-site-association"
  [headers.values]
    Content-Type = "application/json"
    X-Content-Type-Options = "nosniff"

[[headers]]
  for = "/.well-known/assetlinks.json"
  [headers.values]
    Content-Type = "application/json"
    X-Content-Type-Options = "nosniff"
```

Publish directory: `public`.

### Option D — Supabase Edge Function (not recommended but workable)

If you don't have any web host for dvntapp.live at all, you CAN serve
the files from a Supabase Edge Function and point the apex domain
there via a rewrite. But static hosting is simpler and free.

---

## 4 — Verify after deployment

```bash
bash scripts/verify-universal-links.sh
```

This makes nine specific checks:

1. AASA returns HTTP 200 (not 301/302/404)
2. AASA is NOT served through any redirect
3. AASA `Content-Type` is `application/json`
4. AASA body parses as valid JSON
5. AASA contains `com.dvnt.app`
6. AASA contains the `/e/*` path (events)
7. assetlinks.json is reachable, valid JSON, correct `Content-Type`
8. assetlinks.json doesn't still contain `<PLACEHOLDER>` fingerprints
9. Apple's CDN has indexed the AASA (takes up to 48h on first publish)

If the script prints `All checks passed`, you're done on the
domain side.

---

## 5 — Then ship a native build

Even with the domain correctly serving the files, the NATIVE BINARY on
the user's device has to have:

- iOS: the **Associated Domains entitlement** with `applinks:dvntapp.live`
- Android: the **intent-filter** with `autoVerify="true"` on the host

Both are declared in `app.config.js`, which means they only land on user
devices after the next EAS build is installed. Per `DEPLOY.md`:

```bash
npx eas-cli build --platform ios --profile production --auto-submit --non-interactive
npx eas-cli build --platform android --profile production --auto-submit --non-interactive
```

**Important: Android's autoVerify triggers at install time.** After
update, Android re-fetches `assetlinks.json`. If the fingerprints are
wrong or the file 404s, the OS silently falls back to "always ask"
instead of opening the app directly. Verify on device via:

```
adb shell pm get-app-links com.dvnt.app
```

Look for `Status: always` (good) vs `ask` (assetlinks verification
failed).

---

## 6 — Debugging a specific link that won't open

If after deploying + rebuilding a particular URL still doesn't open
the app:

```bash
# On iOS device (install mode):
xcrun simctl openurl booted "https://dvntapp.live/e/20"

# On Android device:
adb shell am start -W -a android.intent.action.VIEW -d "https://dvntapp.live/e/20"
```

On Android, `adb` will tell you if the intent resolved to the app or
the browser. On iOS, watch the console for `[NativeIntent] Incoming:`
logs — if you never see that line, the OS didn't hand the URL to the
app, meaning AASA is still wrong.

As a fallback sanity check, the custom-scheme link always works:

```
dvnt://e/20
```

If `dvnt://e/20` opens the app but `https://dvntapp.live/e/20` doesn't,
the universal-link plumbing is the failure — not the JS router.
