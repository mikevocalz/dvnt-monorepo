'use client';
import dynamic from 'next/dynamic';
const Screen=dynamic(()=>import('@dvnt/app/features/events/checkout-replacement.web'),{ssr:false});
export default function Page(){return <Screen recovery/>;}
