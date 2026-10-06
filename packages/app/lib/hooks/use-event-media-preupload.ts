import { useEffect, useMemo } from "react";
import { uploadToServer } from "@dvnt/app/lib/server-upload";
import {
  isRemoteMediaUri,
  persistLocalMediaSelection,
} from "@dvnt/app/lib/media/persist-local-selection";
import { useCreateEventStore } from "@dvnt/app/lib/stores/create-event-store";
import { useEventMediaPreuploadStore } from "@dvnt/app/lib/media/event-media-preupload-store";
import { runEventMediaPreupload } from "@dvnt/app/lib/media/event-media-preupload-run";

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
    // Serial by design: avoids saturating mobile radios and gives the primary
    // flyer priority while the organizer continues filling the form.
    void runEventMediaPreupload(
      desired,
      {
        getJob: (uri) => useEventMediaPreuploadStore.getState().jobs[uri],
        patch,
        persist: (item) =>
          item.uri.startsWith("blob:") || item.uri.startsWith("data:")
            ? Promise.resolve(item.uri)
            : persistLocalMediaSelection(item.uri, {
                scope: item.slot === "gallery"
                  ? "event-drafts/images"
                  : "event-drafts/flyers",
              }),
        upload: (uri, item, onProgress) =>
          uploadToServer(
            uri,
            "events",
            (p) => onProgress(p.percentage),
            { mimeType: item.mediaType === "video" ? "video/mp4" : undefined },
          ),
        onProgress: (item, percentage) => {
          if (item.slot === "flyer") setProgress(percentage);
        },
        // Bank the CDN URL in the persisted event draft immediately. Publish
        // can then use it without waiting for this upload again.
        bank: (item, url) => {
          if (item.slot === "flyer") {
            if (useCreateEventStore.getState().flyerImage === item.uri) setFlyer(url);
          } else if (item.slot === "poster") {
            if (useCreateEventStore.getState().flyerFallbackImage === item.uri) setPoster(url);
          } else {
            setGallery((prev) => prev.map((uri) => uri === item.uri ? url : uri));
          }
        },
      },
      () => cancelled,
    );
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
