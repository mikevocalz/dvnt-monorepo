'use client';

import dynamic from 'next/dynamic';

// The DVNT marketing landing is universal RN-web code authored in @dvnt/app.
// On web it resolves LandingScreen.web.tsx: the whole scroll timeline runs on
// GSAP/ScrollTrigger + a WebGL layer — no Reanimated on this route (its web
// mappers crashed against detached view descriptors: DVNT-WEB-6). All
// browser-only, so we load it client-side (ssr:false) to avoid hydrating
// animation/WebGL state.
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
