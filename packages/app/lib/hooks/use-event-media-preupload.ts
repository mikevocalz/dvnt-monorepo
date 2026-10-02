import { useEffect, useMemo } from "react";
import { uploadToServer } from "@dvnt/app/lib/server-upload";
import {
  isRemoteMediaUri,
  persistLocalMediaSelection,
} from "@dvnt/app/lib/media/persist-local-selection";
import { useCreateEventStore } from "@dvnt/app/lib/stores/create-event-store";
import { useEventMediaPreuploadStore } from "@dvnt/app/lib/media/event-media-preupload-store";

const LOCAL_MEDIA = /^(blob:|data:|file:|ph:|content:|assets-library:)/i;

function isLocal(uri?: string | null): uri is string {
  return !!uri && !isRemoteMediaUri(uri) && LOCAL_MEDIA.test(uri);
}

export function useEventMediaPreupload() {
  const flyer = useCreateEventStore((s) => s.flyerImage);
  const flyerType = useCreateEventStore((s) => s.flyerMediaType);
  const poster = useCreateEventStore((s) => s.flyerFallbackImage);
  const gallery = useCreateEventStore((s) => s.eventImages);
  const setFlyer = useCreateEventStore((s) => s.setFlyerImage);
  const setPoster = useCreateEventStore((s) => s.setFlyerFallbackImage);
  const setGallery = useCreateEventStore((s) => s.setEventImages);
  const setProgress = useCreateEventStore((s) => s.setUploadProgress);

  const jobs = useEventMediaPreuploadStore((s) => s.jobs);
  const queue = useEventMediaPreuploadStore((s) => s.queue);
  const patch = useEventMediaPreuploadStore((s) => s.patch);

  const desired = useMemo(() => {
    const entries: Array<{
      uri: string; slot: "flyer"|"poster"|"gallery"; mediaType: "image"|"video";
    }> = [];
    if (isLocal(flyer)) entries.push({ uri: flyer, slot: "flyer", mediaType: flyerType });
    if (isLocal(poster)) entries.push({ uri: poster, slot: "poster", mediaType: "image" });
    for (const uri of gallery) if (isLocal(uri)) {
      entries.push({ uri, slot: "gallery", mediaType: "image" });
    }
    return entries;
  }, [flyer, flyerType, gallery, poster]);

  useEffect(() => {
    for (const item of desired) {
      queue({ localUri: item.uri, slot: item.slot, mediaType: item.mediaType });
    }
  }, [desired, queue]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      // Serial by design: avoids saturating mobile radios and gives the primary
      // flyer priority while the organizer continues filling the form.
      for (const item of desired) {
        if (cancelled) return;
        const current = useEventMediaPreuploadStore.getState().jobs[item.uri];
        if (!current || !["queued", "failed"].includes(current.state)) continue;
        // Do not spin forever on a permanent server rejection. The explicit
        // retry action can move a failed job back to queued.
        if (current.state === "failed" && current.attempts >= 2) continue;

        patch(item.uri, {
          state: "uploading",
          attempts: current.attempts + 1,
          error: undefined,
        });
        try {
          const durableUri = item.uri.startsWith("blob:") || item.uri.startsWith("data:")
            ? item.uri
            : await persistLocalMediaSelection(item.uri, {
                scope: item.slot === "gallery"
                  ? "event-drafts/images"
                  : "event-drafts/flyers",
              });
          const result = await uploadToServer(
            durableUri,
            "events",
            (p) => {
              patch(item.uri, { progress: p.percentage });
              if (item.slot === "flyer") setProgress(p.percentage);
            },
            { mimeType: item.mediaType === "video" ? "video/mp4" : undefined },
          );
          if (!result.success || !result.url) {
            throw new Error(result.error || "Media upload failed");
          }
          if (cancelled) return;
          patch(item.uri, {
            state: "uploaded",
            progress: 100,
            remoteUrl: result.url,
            error: undefined,
          });
          // Bank the CDN URL in the persisted event draft immediately. Publish
          // can now use it without waiting for this upload again.
          if (item.slot === "flyer") {
            if (useCreateEventStore.getState().flyerImage === item.uri) setFlyer(result.url);
          } else if (item.slot === "poster") {
            if (useCreateEventStore.getState().flyerFallbackImage === item.uri) setPoster(result.url);
          } else {
            setGallery((prev) => prev.map((uri) => uri === item.uri ? result.url : uri));
          }
        } catch (error) {
          if (cancelled) return;
          patch(item.uri, {
            state: "failed",
            progress: 0,
            error: error instanceof Error ? error.message : "Media upload failed",
          });
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [desired, patch, setFlyer, setGallery, setPoster, setProgress]);

  const active = Object.values(jobs).filter((job) =>
    desired.some((item) => item.uri === job.localUri) &&
    (job.state === "queued" || job.state === "uploading")
  );
  const failed = Object.values(jobs).filter((job) =>
    desired.some((item) => item.uri === job.localUri) && job.state === "failed"
  );

  return { active, failed };
}
