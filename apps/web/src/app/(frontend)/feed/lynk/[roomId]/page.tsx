'use client';

/**
 * Lynk Live (MoQ) room — web route.
 *
 * The screen, its broadcaster/viewer stages and the whole MoQ transport
 * (lib/lynk/useLynkBroadcast.web, useLynkViewer.web) already existed and were
 * fully wired; there was simply no Next route rendering any of it, so nothing
 * on web could ever start a MoQ session. Native has had
 * `app/(protected)/lynk/[roomId].tsx` all along, and its own comment names the
 * web half ("index.web.tsx (broadcaster+viewer)").
 *
 * Sits under `feed/` so it inherits that segment's auth layout, matching the
 * sneaky-lynk room route. The screen reads `roomId` itself via solito's
 * `useParams`, so this file only has to mount it.
 */

import dynamic from 'next/dynamic';

const LynkRoomScreen = dynamic(
  () => import('@dvnt/app/features/screens/(protected)/lynk/[roomId]/web'),
  { ssr: false },
);

export default function Page() {
  return <LynkRoomScreen />;
}
