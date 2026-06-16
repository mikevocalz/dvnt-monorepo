'use client';
import dynamic from 'next/dynamic';
const HomeScreen = dynamic(
  () => import('@dvnt/app/features/home/screen').then((m) => m.HomeScreen),
  { ssr: false },
);
export default function Page() {
  return <HomeScreen />;
}
