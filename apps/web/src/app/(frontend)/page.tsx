'use client';

import dynamic from 'next/dynamic';
import { RedirectIfAuthed } from '@dvnt/app/components/web-auth-redirect';

// DVNT marketing landing — universal RN-web code in @dvnt/app. On web it
// resolves LandingScreen.web.tsx: the scroll timeline runs entirely on
// GSAP/ScrollTrigger + a WebGL layer through .web.tsx splits — NO Reanimated
// executes on this route (its web mappers fired per frame against detached
// view descriptors after unmount, the DVNT-WEB-6 Sentry flood). All
// browser-only, so we load it client-side (ssr:false) to avoid hydrating
// animation/WebGL state.
const LandingScreen = dynamic(
  () =>
    import('@dvnt/app/features/screens/landing/LandingScreen').then(
      (m) => m.LandingScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return (
    <>
      <RedirectIfAuthed />
      <LandingScreen />
    </>
  );
}
