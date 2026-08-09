'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createDvntQueryClient } from './queryClient';
import { createPlatformPersister, shouldDehydrateQuery } from './persistence';

interface ApiProviderProps {
  children: ReactNode;
}

// Evicts every persisted cache when the deployed commit changes, so a release
// can never be read through a previous build's snapshot. Native uses a manual
// "v11" string for the same purpose.
const BUSTER = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev';

// Native persists for 30 minutes; web was defaulting to 24 HOURS, which is how
// a day-old feed survived a page load.
const MAX_AGE = 30 * 60 * 1000;

export function ApiProvider({ children }: ApiProviderProps) {
  const [queryClient] = useState(() => createDvntQueryClient());
  const [persister] = useState(() => createPlatformPersister());

  if (persister) {
    return (
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister,
          maxAge: MAX_AGE,
          buster: BUSTER,
          dehydrateOptions: { shouldDehydrateQuery },
        }}
      >
        {children}
      </PersistQueryClientProvider>
    );
  }

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
