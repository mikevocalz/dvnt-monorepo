/**
 * Development Guards for Supabase Operations
 * 
 * These guards help catch incorrect usage patterns during development.
 * They log warnings when code attempts privileged operations directly
 * instead of using Edge Functions.
 */

const PRIVILEGED_TABLES = ["users"];

/**
 * Wrap the Supabase client to add development warnings
 * for direct writes to privileged tables.
 * 
 * This should be called once during app initialization in dev mode.
 */
export function installDevGuards(supabaseClient: any): void {
  if (__DEV__ === false) {
    // Only install guards in development
    return;
  }

  const originalFrom = supabaseClient.from.bind(supabaseClient);

  supabaseClient.from = (table: string) => {
    const queryBuilder = originalFrom(table);

    if (PRIVILEGED_TABLES.includes(table)) {
      // Wrap update/insert/delete methods to log warnings
      const originalUpdate = queryBuilder.update?.bind(queryBuilder);
      const originalInsert = queryBuilder.insert?.bind(queryBuilder);
      const originalDelete = queryBuilder.delete?.bind(queryBuilder);

      if (originalUpdate) {
        queryBuilder.update = (...args: any[]) => {
          console.warn(
            `\x1b[31m[DEV GUARD] ⚠️ Direct .update() on "${table}" table detected!\x1b[0m\n` +
            `Use Edge Function for privileged writes.\n` +
            `See: lib/supabase/privileged.ts and docs/AUTH_RLS.md`
          );
          return originalUpdate(...args);
        };
      }

      if (originalInsert) {
        queryBuilder.insert = (...args: any[]) => {
          console.warn(
            `\x1b[31m[DEV GUARD] ⚠️ Direct .insert() on "${table}" table detected!\x1b[0m\n` +
            `Use Edge Function for privileged writes.\n` +
            `See: lib/supabase/privileged.ts and docs/AUTH_RLS.md`
          );
          return originalInsert(...args);
        };
      }

      if (originalDelete) {
        queryBuilder.delete = (...args: any[]) => {
          console.warn(
            `\x1b[31m[DEV GUARD] ⚠️ Direct .delete() on "${table}" table detected!\x1b[0m\n` +
            `Use Edge Function for privileged writes.\n` +
            `See: lib/supabase/privileged.ts and docs/AUTH_RLS.md`
          );
          return originalDelete(...args);
        };
      }
    }

    return queryBuilder;
  };

  console.log("[DEV GUARD] Installed guards for privileged table writes");
}
