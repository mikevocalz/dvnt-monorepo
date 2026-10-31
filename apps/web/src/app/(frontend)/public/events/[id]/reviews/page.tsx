'use client';

import dynamic from 'next/dynamic';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';

const EventReviewsScreen = dynamic(
  () => import('@dvnt/app/features/events/reviews.web').then(m => m.EventReviewsScreen),
  { ssr: false },
);

/** Browser-only email landing: /public/events is deliberately not claimed by
 * Universal Links, so older installed apps cannot swallow the rating link.
 * This is still an authenticated surface, not public review submission. */
export default function Page() {
  return <WebAppShell><EventReviewsScreen /></WebAppShell>;
}
