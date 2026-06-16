# Vercel Deployment Guide

## Overview

This monorepo deploys two separate Vercel projects from the same GitHub repository:

| App | Domain | Framework | Purpose |
|-----|--------|-----------|---------|
| `apps/web` | `blog.dvntapp.live` | Next.js 16 | Public blog & marketing site |
| `apps/web-vite` | `admin.dvnt.app` | TanStack Start + Payload v4 | Admin dashboard & CMS |

## Prerequisites

- Vercel account connected to your GitHub repo
- pnpm enabled in Vercel project settings
- Environment variables configured (see below)

## Project Setup

### 1. Blog (apps/web)

**Vercel Configuration:**
- **Root Directory:** `apps/web`
- **Framework Preset:** Next.js
- **Build Command:** `cd ../.. && pnpm install && pnpm --filter web build`
- **Output Directory:** `.next`

**Environment Variables:**
```bash
# Required
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_AUTH_URL=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_AUDIENCE_ID=

# Optional (defaults in code)
EXPO_PUBLIC_AUTH_SAME_ORIGIN=true
NODE_ENV=production
```

**Custom Domain:**
Add `blog.dvntapp.live` in Vercel project settings → Domains

### 2. Admin Dashboard (apps/web-vite)

**Vercel Configuration:**
- **Root Directory:** `apps/web-vite`
- **Framework Preset:** `Other` (custom Vite/TanStack Start)
- **Build Command:** `cd ../.. && pnpm install && pnpm --filter web-vite build`
- **Output Directory:** `dist`

**Environment Variables:**
```bash
# Database (required)
DATABASE_URI=postgresql://...

# Payload CMS (required)
PAYLOAD_SECRET=

# Supabase (required)
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=

# Storage (optional, defaults to local)
BUNNY_STORAGE_KEY=
BUNNY_STORAGE_ZONE=
BUNNY_STORAGE_HOST=

# Node
NODE_ENV=production
```

**Custom Domain:**
Add `admin.dvnt.app` in Vercel project settings → Domains

## Environment Files (DO NOT COMMIT)

The following files are gitignored and should be configured in Vercel dashboard:

```
apps/web/.env
apps/web/.env.local
apps/web-vite/.env
```

Use `.env.example` files as templates for required variables.

## Important Security Notes

- ✅ `.env*` files are gitignored at root and app levels
- ✅ No credentials in repository
- ✅ All API keys must be set in Vercel dashboard only
- ✅ `vercel.json` configs include security headers

## Troubleshooting

### Blog build fails
- Check `EXPO_PUBLIC_*` variables are set
- Verify pnpm is enabled in Vercel settings
- Check `apps/web/.env.local` is NOT committed

### Admin build fails
- Verify `DATABASE_URI` is accessible from Vercel (use Supabase connection pooling)
- Check `PAYLOAD_SECRET` is set
- Ensure `dist/` folder is created in build output

## Post-Deployment Verification

1. **Blog:** Check `/posts` loads, newsletter form submits
2. **Admin:** Verify Payload login at `/admin`, media uploads work
3. **APIs:** Test `/api/newsletter` (blog) and `/api/*` (admin)
