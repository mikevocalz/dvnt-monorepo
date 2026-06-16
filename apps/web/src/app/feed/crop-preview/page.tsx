'use client';

import dynamic from 'next/dynamic';

const CropPreviewScreen = dynamic(
  () => import('@dvnt/app/features/create/crop-preview.web').then((m) => m.CropPreviewScreen),
  { ssr: false },
);

export default function Page() {
  return <CropPreviewScreen />;
}
