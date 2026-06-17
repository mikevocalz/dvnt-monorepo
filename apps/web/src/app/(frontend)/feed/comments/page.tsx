'use client';
import { useEffect } from 'react';
import { useRouter } from 'solito/navigation';
export default function Page() {
  const router = useRouter();
  useEffect(() => { router.replace('/feed'); }, [router]);
  return null;
}
