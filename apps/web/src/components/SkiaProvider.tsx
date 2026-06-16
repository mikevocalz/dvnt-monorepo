'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

interface SkiaProviderProps {
  children: ReactNode;
  fallback?: ReactNode;
}

let skiaReady = false;
let skiaPromise: Promise<void> | null = null;

function ensureSkia() {
  if (skiaReady) return Promise.resolve();
  if (!skiaPromise) {
    skiaPromise = LoadSkiaWeb().then(() => {
      skiaReady = true;
    });
  }
  return skiaPromise;
}

export function SkiaProvider({ children, fallback }: SkiaProviderProps) {
  const [ready, setReady] = useState(skiaReady);

  useEffect(() => {
    if (skiaReady) return;
    ensureSkia().then(() => setReady(true));
  }, []);

  if (!ready) return <>{fallback ?? null}</>;
  return <>{children}</>;
}
