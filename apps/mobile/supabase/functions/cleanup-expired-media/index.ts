/**
 * Supabase Edge Function: cleanup-expired-media
 *
 * Runs on schedule (cron):
 * - Every hour: Delete temp/* and expired stories
 * - Every day: Delete orphaned files
 *
 * Deploy:
 * supabase functions deploy cleanup-expired-media
 *
 * Schedule (add to Supabase dashboard):
 * 0 * * * * (every hour)
 */

// @ts-ignore - Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface CleanupResult {
  deletedMedia: number;
  deletedStorageFiles: number;
  errors: string[];
  duration: number;
}

// @ts-ignore - Deno runtime
Deno.serve(async (req: any) => {
  const startTime = Date.now();
  const result: CleanupResult = {
    deletedMedia: 0,
    deletedStorageFiles: 0,
    errors: [],
    duration: 0,
  };

  try {
    // Initialize Supabase client with service role key
    // @ts-ignore - Deno runtime
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-ignore - Deno runtime
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log("[Cleanup] Starting expired media cleanup...");

    // =========================================================================
    // STEP 1: Delete expired media from database
    // =========================================================================

    const { data: expiredMedia, error: fetchError } = await supabase
      .from("media")
      .select("id, storage_path, bucket_name")
      .not("expires_at", "is", null)
      .lt("expires_at", new Date().toISOString());

    if (fetchError) {
      result.errors.push(
        `Failed to fetch expired media: ${fetchError.message}`,
      );
      return Response.json(result, { status: 500 });
    }

    console.log(
      `[Cleanup] Found ${expiredMedia?.length || 0} expired media records`,
    );

    // Delete from storage first, then database
    if (expiredMedia && expiredMedia.length > 0) {
      for (const media of expiredMedia) {
        try {
          // Delete from storage
          const { error: storageError } = await supabase.storage
            .from(media.bucket_name)
            .remove([media.storage_path]);

          if (storageError) {
            console.error(
              `[Cleanup] Failed to delete ${media.storage_path}:`,
              storageError,
            );
            result.errors.push(`Storage: ${media.storage_path}`);
          } else {
            result.deletedStorageFiles++;
          }

          // Delete from database
          const { error: dbError } = await supabase
            .from("media")
            .delete()
            .eq("id", media.id);

          if (dbError) {
            console.error(
              `[Cleanup] Failed to delete media record ${media.id}:`,
              dbError,
            );
            result.errors.push(`DB: ${media.id}`);
          } else {
            result.deletedMedia++;
          }
        } catch (error) {
          console.error(`[Cleanup] Error processing media ${media.id}:`, error);
          result.errors.push(`Exception: ${media.id}`);
        }
      }
    }

    // =========================================================================
    // STEP 2: Delete orphaned storage files (not in database)
    // This runs less frequently (check via cron schedule)
    // =========================================================================

    const isFullCleanup = new URL(req.url).searchParams.get("full") === "true";

    if (isFullCleanup) {
      console.log("[Cleanup] Running full orphan cleanup...");

      const buckets = ["avatars", "images", "videos", "stories", "temp"];

      for (const bucket of buckets) {
        try {
          // List all files in bucket
          const { data: files, error: listError } = await supabase.storage
            .from(bucket)
            .list("", {
              limit: 1000,
              offset: 0,
            });

          if (listError) {
            result.errors.push(`List ${bucket}: ${listError.message}`);
            continue;
          }

          console.log(
            `[Cleanup] Checking ${files?.length || 0} files in ${bucket}`,
          );

          // Check each file against database
          if (files) {
            for (const file of files) {
              const storagePath = file.name;

              // Check if file exists in database
              const { data: mediaRecord } = await supabase
                .from("media")
                .select("id")
                .eq("storage_path", storagePath)
                .eq("bucket_name", bucket)
                .maybeSingle();

              // If not in database, delete from storage
              if (!mediaRecord) {
                console.log(`[Cleanup] Orphaned file: ${storagePath}`);

                const { error: deleteError } = await supabase.storage
                  .from(bucket)
                  .remove([storagePath]);

                if (deleteError) {
                  result.errors.push(
                    `Orphan ${storagePath}: ${deleteError.message}`,
                  );
                } else {
                  result.deletedStorageFiles++;
                }
              }
            }
          }
        } catch (error) {
          console.error(`[Cleanup] Error processing bucket ${bucket}:`, error);
          result.errors.push(`Bucket ${bucket}: ${error}`);
        }
      }
    }

    result.duration = Date.now() - startTime;

    console.log("[Cleanup] Complete:", {
      deletedMedia: result.deletedMedia,
      deletedStorageFiles: result.deletedStorageFiles,
      errors: result.errors.length,
      duration: `${result.duration}ms`,
    });

    return Response.json(result, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Cleanup] Fatal error:", error);
    result.errors.push(`Fatal: ${error}`);
    result.duration = Date.now() - startTime;

    return Response.json(result, { status: 500 });
  }
});

/**
 * DEPLOYMENT INSTRUCTIONS:
 *
 * 1. Create function:
 *    supabase functions new cleanup-expired-media
 *
 * 2. Copy this file to:
 *    supabase/functions/cleanup-expired-media/index.ts
 *
 * 3. Deploy:
 *    supabase functions deploy cleanup-expired-media
 *
 * 4. Set up cron job in Supabase Dashboard:
 *    - Go to Database → Extensions → Enable pg_cron
 *    - Add cron job:
 *
 *    SELECT cron.schedule(
 *      'cleanup-expired-media-hourly',
 *      '0 * * * *',  -- Every hour
 *      $$
 *      SELECT net.http_post(
 *        url := 'https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-expired-media',
 *        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
 *      );
 *      $$
 *    );
 *
 *    -- Full cleanup (orphans) runs daily at 2 AM
 *    SELECT cron.schedule(
 *      'cleanup-orphaned-media-daily',
 *      '0 2 * * *',  -- 2 AM daily
 *      $$
 *      SELECT net.http_post(
 *        url := 'https://YOUR_PROJECT.supabase.co/functions/v1/cleanup-expired-media?full=true',
 *        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb
 *      );
 *      $$
 *    );
 *
 * 5. Monitor logs:
 *    supabase functions logs cleanup-expired-media
 *
 * COST IMPACT:
 * - Hourly cleanup: ~500ms execution = $0.0001/run
 * - Daily cleanup: ~10s execution = $0.002/run
 * - Total monthly cost: < $5
 * - Savings from cleanup: $50-500/month (depends on scale)
 *
 * ROI: 10-100x return on function execution cost
 */
