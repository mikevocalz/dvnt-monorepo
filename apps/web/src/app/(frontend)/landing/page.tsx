'use client';

import dynamic from 'next/dynamic';

// The DVNT marketing landing is universal RN-web code authored in @dvnt/app.
// It drives its scroll timeline with Reanimated + window-scroll and mounts a
// web-only GSAP/R3F layer through .web.tsx splits — all browser-only, so we
// load it client-side (ssr:false) to avoid hydrating animation/WebGL state.
const LandingScreen = dynamic(
  () =>
    import('@dvnt/app/features/screens/landing/LandingScreen').then(
      (m) => m.LandingScreen,
    ),
  { ssr: false },
);

export default function LandingPage() {
  return <LandingScreen />;
}
