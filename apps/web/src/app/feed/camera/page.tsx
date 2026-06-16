'use client';

import dynamic from 'next/dynamic';

const CameraScreen = dynamic(
  () => import('@dvnt/app/features/create/camera.web').then((m) => m.CameraScreen),
  { ssr: false },
);

export default function Page() {
  return <CameraScreen />;
}
