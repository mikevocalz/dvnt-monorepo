# Auth & Email Flows — Architecture Reference

> **Last updated:** 2026-02-06
> **Owner:** Staff/Principal Engineer

## Overview

All authentication is handled by **Better Auth** (Expo integration) with **Supabase Postgres** as the database. All transactional email is delivered via **Resend**.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────┐
│  Expo App   │────▶│  Better Auth     │────▶│ Resend  │
│  (Client)   │     │  (API Routes)    │     │  (SMTP) │
└─────────────┘     └──────────────────┘     └─────────┘
       │                     │
       │              ┌──────┴──────┐
       │              │  Supabase   │
       └─────────────▶│  Postgres   │
                      └─────────────┘
                             │
                      ┌──────┴──────┐
                      │  Edge Fn:   │──────▶ Resend
                      │  send-email │
                      └─────────────┘
```

## Email Flows

### 1. Welcome Email (on signup)
- **Trigger:** `databaseHooks.user.create.after` in `lib/auth.ts`
- **Sender:** Resend SDK (server-side, in Better Auth API route)
- **Template:** Dark-themed branded HTML with CTA to open app

### 2. Email Verification
- **Trigger:** `emailAndPassword.sendVerificationEmail` in `lib/auth.ts`
- **Sender:** Resend SDK (server-side)
- **Deep link:** `dvnt://(auth)/verify-email?token=XXX`
- **Screen:** `app/(auth)/verify-email.tsx`
- **Note:** Currently `requireEmailVerification: false`. Flip to `true` once `dvnt.app` domain is verified in Resend.

### 3. Password Reset
- **Trigger:** Client calls `authClient.forgetPassword({ email, redirectTo })`
- **Handler:** `emailAndPassword.sendResetPassword` in `lib/auth.ts`
- **Sender:** Resend SDK (server-side)
- **Deep link:** `dvnt://(auth)/reset-password?token=XXX`
- **Screen:** `app/(auth)/reset-password.tsx`

### 4. Edge Function: send-email
- **Path:** `supabase/functions/send-email/index.ts`
- **Purpose:** Centralized email delivery for edge-triggered emails (not Better Auth callbacks)
- **Templates:** `welcome`, `confirm-email`, `reset-password`
- **Auth:** Optional Better Auth session verification
- **Usage:** POST with `{ template, to, data: { name?, url? } }`

## Environment Variables

| Variable | Scope | Description |
|----------|-------|-------------|
| `RESEND_API_KEY` | Server-only | Resend API token (`re_...`) |
| `RESEND_FROM_EMAIL` | Server-only | Verified sender address |
| `DATABASE_URL` | Server-only | Supabase Postgres connection |
| `EXPO_PUBLIC_AUTH_URL` | Client | Better Auth server URL |

All env vars MUST be in:
- `.env` (local dev)
- `eas.json` (all 3 build profiles: development, preview, production)
- EAS Secrets (for CI/CD)

## Deep Link Routes

| Route | Purpose |
|-------|---------|
| `dvnt://(auth)/reset-password` | Password reset form |
| `dvnt://(auth)/verify-email` | Email verification handler |
| `dvnt://(auth)/forgot-password` | Request password reset |

## Files

| File | Purpose |
|------|---------|
| `lib/auth.ts` | Better Auth server config (email handlers, hooks) |
| `lib/auth-client.ts` | Better Auth client (Expo, SecureStore) |
| `app/(auth)/forgot-password.tsx` | Forgot password screen |
| `app/(auth)/reset-password.tsx` | Reset password screen (deep link target) |
| `app/(auth)/verify-email.tsx` | Email verification screen (deep link target) |
| `app/(auth)/_layout.tsx` | Auth stack layout (all screens registered) |
| `supabase/functions/send-email/index.ts` | Centralized edge function for email |

## Regression Guardrails

1. **ALL email sending goes through Resend** — never use Supabase built-in SMTP
2. **No inline email logic in client code** — all email is server-side
3. **Fail loudly in DEV, soft fail in PROD** — see `sendEmail()` in `lib/auth.ts`
4. **Log every email send** — `[Auth:Email] ✓ Sent "subject" to email`
5. **Log every failure** — `[Auth:Email] ✗ Failed to send "subject" to email`
6. **Env vars in ALL eas.json profiles** — never skip a profile
7. **Production fallbacks** — `FROM_EMAIL` defaults to `DVNT <noreply@dvnt.app>`

## Smoke Test Checklist

- [ ] New user signup → welcome email received
- [ ] New user signup → confirmation email (when `requireEmailVerification: true`)
- [ ] Confirm email link opens app at verify-email screen
- [ ] Forgot password → reset email received
- [ ] Reset password link opens app at reset-password screen
- [ ] Password resets successfully
- [ ] Session persists across app restart
- [ ] Session refreshes after 24h
- [ ] Works on iOS
- [ ] Works on Android
- [ ] Works in dev build
- [ ] Works in production build
- [ ] Edge function `send-email` returns 200 for all templates
- [ ] Resend dashboard shows delivered emails
