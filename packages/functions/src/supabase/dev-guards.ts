const PRIVILEGED_TABLES = ['users'];

declare const __DEV__: boolean | undefined;
declare const process: { env: { NODE_ENV?: string } } | undefined;

function isDevRuntime() {
  if (typeof __DEV__ !== 'undefined') {
    return __DEV__ !== false;
  }

  return process?.env?.NODE_ENV !== 'production';
}

export function installDevGuards(supabaseClient: any): void {
  if (!isDevRuntime()) {
    return;
  }

  const originalFrom = supabaseClient.from.bind(supabaseClient);

  supabaseClient.from = (table: string) => {
    const queryBuilder = originalFrom(table);

    if (PRIVILEGED_TABLES.includes(table)) {
      const originalUpdate = queryBuilder.update?.bind(queryBuilder);
      const originalInsert = queryBuilder.insert?.bind(queryBuilder);
      const originalDelete = queryBuilder.delete?.bind(queryBuilder);

      if (originalUpdate) {
        queryBuilder.update = (...args: any[]) => {
          console.warn(
            `[DEV GUARD] Direct .update() on "${table}" table detected.\n` +
              'Use Edge Functions for privileged writes.\n' +
              'See: lib/supabase/privileged.ts and docs/AUTH_RLS.md',
          );
          return originalUpdate(...args);
        };
      }

      if (originalInsert) {
        queryBuilder.insert = (...args: any[]) => {
          console.warn(
            `[DEV GUARD] Direct .insert() on "${table}" table detected.\n` +
              'Use Edge Functions for privileged writes.\n' +
              'See: lib/supabase/privileged.ts and docs/AUTH_RLS.md',
          );
          return originalInsert(...args);
        };
      }

      if (originalDelete) {
        queryBuilder.delete = (...args: any[]) => {
          console.warn(
            `[DEV GUARD] Direct .delete() on "${table}" table detected.\n` +
              'Use Edge Functions for privileged writes.\n' +
              'See: lib/supabase/privileged.ts and docs/AUTH_RLS.md',
          );
          return originalDelete(...args);
        };
      }
    }

    return queryBuilder;
  };

  console.log('[DEV GUARD] Installed guards for privileged table writes');
}
