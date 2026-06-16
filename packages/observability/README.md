# @dvnt/observability

Production-grade Sentry observability layer for the DVNT monorepo. Shared by `apps/mobile` (Expo) and `apps/web-vite` (admin/blog dashboard).

## Architecture

```
packages/observability/
├── src/
│   ├── index.ts              # Main barrel + initObservability()
│   ├── types.ts              # Core types, sensitive key registry, feature areas
│   ├── sanitize.ts           # Privacy/redaction layer (beforeSend, sanitizeForSentry)
│   ├── user.ts               # identifySentryUser / clearSentryUser
│   ├── context.ts            # Route/screen/feature/auth/network tagging
│   ├── breadcrumbs.ts        # Safe breadcrumb wrappers (auto-redacts)
│   ├── spans.ts              # Performance measurement (startSentrySpan, measureAsync)
│   ├── capture.ts            # Error capture (handled, API, flow, media, sneaky-link, messaging, moderation)
│   ├── release.ts            # OTA/release health tracking (setReleaseInfo, updateOTAInfo)
│   ├── bridge.ts             # Product analytics bridge (Supabase ↔ Sentry breadcrumbs)
│   ├── init/
│   │   ├── expo.ts           # initExpoSentry() — call in _layout.tsx
│   │   └── web.ts            # initWebSentry() — call in main.tsx
│   ├── flows/
│   │   ├── auth.ts           # Login, signup, session restore, forgot password
│   │   ├── feed.ts           # Feed load, post create, post media upload
│   │   ├── stories.ts        # Story create, playback, reply
│   │   ├── events.ts         # Event open, RSVP, ticket checkout, QR scan
│   │   ├── messaging.ts      # Message button, inbox, DM thread, send, deep link
│   │   ├── sneaky-link.ts    # Create, join, permissions, face access, room connection
│   │   ├── media.ts          # Picker, compress, upload, render, playback
│   │   ├── moderation.ts     # Report, block, unblock, moderation actions
│   │   └── blog.ts           # Blog index, post, Payload fetch, preview, newsletter, admin
│   ├── dashboard/
│   │   └── types.ts          # Dashboard types + RECOMMENDED_ALERTS
│   └── __tests__/
│       ├── sanitize.test.ts
│       ├── user-context.test.ts
│       └── capture.test.ts
```

## Quick Start

### Expo App (apps/mobile)

```ts
// app/_layout.tsx
import * as Sentry from '@sentry/react-native';
import { initExpoSentry } from '@dvnt/observability/init/expo';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

initExpoSentry(Sentry, {
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN!,
  environment: __DEV__ ? 'development' : 'production',
  appVersion: Constants.expoConfig?.version ?? '1.0.0',
  buildNumber: Constants.expoConfig?.ios?.buildNumber ?? '1',
  runtimeVersion: Updates.runtimeVersion,
  expoUpdateId: Updates.updateId,
  updateChannel: Updates.channel,
  platform: Platform.OS as 'ios' | 'android',
});
```

### Vite-Web (apps/web-vite)

```ts
// src/main.tsx or src/router.tsx
import * as Sentry from '@sentry/react';
import { initWebSentry } from '@dvnt/observability/init/web';

initWebSentry(Sentry, {
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  appVersion: import.meta.env.VITE_APP_VERSION ?? '0.1.0',
});
```

### User Context (after login)

```ts
import { identifySentryUser, clearSentryUser } from '@dvnt/observability';

// On login
identifySentryUser({
  id: user.id,
  username: user.username,
  role: user.role,
  accountStatus: user.accountStatus,
  appVersion: '1.0.0',
  buildNumber: '42',
  platform: 'ios',
});

// On logout
clearSentryUser();
```

### Flow Instrumentation

```ts
import { flows } from '@dvnt/observability';

// Message button tap
flows.messageButtonTap({ screen: '/profile/user_123' });

// Inbox load
const timer = flows.inboxQueryStarted({ screen: '/messages' });
try {
  const data = await fetchInbox();
  const duration = timer.finish();
  flows.inboxQuerySuccess(duration);
} catch (err) {
  timer.finish('error');
  flows.inboxQueryFailure(err, { route: '/messages', networkStatus: 'online' });
}
```

## Environment Variables

### Expo App
- `EXPO_PUBLIC_SENTRY_DSN` — Sentry project DSN

### Vite-Web
- `VITE_SENTRY_DSN` — Sentry project DSN
- `VITE_SENTRY_ORG` — Sentry org slug (for dashboard API)
- `VITE_SENTRY_PROJECT` — Sentry project slug (for dashboard API)
- `VITE_SENTRY_AUTH_TOKEN` — Sentry API token with `project:read`, `org:read` scopes

## Testing

```bash
cd packages/observability
pnpm test
```

## Privacy Rules

The sanitization layer (`sanitize.ts`) automatically redacts:
- Passwords, tokens, secrets, API keys
- Authorization headers, cookies
- Payment data (card numbers, CVV, client secrets)
- Phone numbers
- DM text / message body content
- Private report/moderation notes
- Signed storage URLs (Supabase, S3)
- Draft/unpublished blog content

Emails are **masked** (not redacted) — `j***e@gmail.com` — except for safe domains (`dvntapp.live`, `dvnt.app`).

## Alerting Recommendations

See `RECOMMENDED_ALERTS` in `src/dashboard/types.ts`. Critical alerts:

| Alert | Threshold | Action |
|-------|-----------|--------|
| Crash spike after OTA | 10 errors in 30m | Page on-call, rollback OTA |
| Message button errors | 5 errors in 15m | Alert iOS team |
| Checkout failures | 3 errors in 10m | Check Stripe, alert payments |
| Sneaky Link connection | 5 errors in 15m | Check Fishjam/TURN |
| Payload/blog 500s | 5 errors in 10m | Check Payload server |
| JS fatal errors | 5 in 1 hour | Investigate crash, hotfix OTA |

## QA Checklist

- [ ] Sentry user context set after login (verify in Sentry user tab)
- [ ] Sentry user context cleared after logout
- [ ] Sensitive data never appears in Sentry events (spot check)
- [ ] Message body never sent to Sentry (verify breadcrumbs/extra)
- [ ] Auth tokens never sent to Sentry (check request data)
- [ ] Signed media URLs redacted (check breadcrumbs)
- [ ] App version/build/OTA tags exist on all events
- [ ] Route/screen/featureArea tags exist on all events
- [ ] Message button errors captured with correct tags
- [ ] Payload fetch errors captured with collection tag
- [ ] Flow failures include flow name and step name
- [ ] Release string format: `com.dvnt.app@{version}+{build}`
- [ ] OTA update tag updated on app update without restart
- [ ] Admin Sentry dashboard only accessible to admin/super-admin roles
- [ ] Session replay masks input fields
- [ ] beforeSend fires on every event (test with console.log in dev)
- [ ] Alerts configured for critical flows (message, checkout, OTA)
- [ ] Error boundaries capture with screen name tag

## Assumptions

1. Sentry SDK versions: `@sentry/react-native >=6.x`, `@sentry/react >=8.x`
2. The Expo app uses `expo-updates` for OTA — `Updates.updateId` and `Updates.channel` are available
3. The vite-web admin dashboard uses role-based access control (admin/super-admin only for Sentry Health)
4. Sentry API token for the dashboard is read-only and stored server-side or in a secure env var
5. Product analytics (counts, engagement) live in Supabase — Sentry only gets diagnostic breadcrumbs
6. The existing `AppTrace` utility will be updated in a follow-up to delegate to this package
