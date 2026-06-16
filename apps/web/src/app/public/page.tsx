'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(() => import('@dvnt/app/features/home/screen.web').then((m) => m.HomeScreen), { ssr: false });
export default function Page() { return <Screen />; }
