"use client";

// web-vitals-reporter — stub. The original component was referenced from
// (frontend)/layout.tsx but never committed to the repo, so the Vercel build
// aborted with "Module not found: Can't resolve '@/components/web-vitals-reporter'".
// Stubbed to a no-op so the build succeeds; wire real reporting (Sentry,
// Vercel Analytics, custom PostHog, etc.) by replacing this file.
export function WebVitalsReporter(): null {
  return null;
}

export default WebVitalsReporter;
