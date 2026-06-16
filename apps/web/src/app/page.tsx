'use client';

import dynamic from 'next/dynamic';
import { RedirectIfAuthed } from '@dvnt/app/components/web-auth-redirect';

// DVNT marketing landing — universal RN-web code in @dvnt/app. It drives its
// scroll timeline with Reanimated + window-scroll and mounts a web-only GSAP/R3F
// layer through .web.tsx splits, all browser-only, so we load it client-side
// (ssr:false) to avoid hydrating animation/WebGL state.
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
