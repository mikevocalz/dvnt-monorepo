"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { getFollowIdentity, isFollowIdentityCurrent, getFollowIdentityRevision, subscribeFollowIdentityRevision } from "@dvnt/app/lib/auth/follow-identity";

/** Only a server-generated tiny raster is rendered. Never accepts an original URL. */
export function ProtectedPhotoPreview({ postId }: { postId?: string }) {
  const revision = useSyncExternalStore(subscribeFollowIdentityRevision, getFollowIdentityRevision, getFollowIdentityRevision);
  const session = useSyncExternalStore(subscribeSessionLifecycle, getSessionLifecycle, getSessionLifecycle);
  const [preview, setPreview] = useState<{ id: string; revision: number; epoch: number; src: string } | null>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    const identity = getFollowIdentity();
    if (!postId || !identity) return;
    void (async () => {
      try {
        const token = await requireBetterAuthToken();
        if (!active || !isFollowIdentityCurrent(identity)) return;
        const { data, error } = await supabase.functions.invoke("protected-photo-preview", {
          body: { postId }, headers: { Authorization: `Bearer ${token}` },
        });
        const src = data?.preview;
        if (!error && active && isFollowIdentityCurrent(identity) && typeof src === "string" && src.length < 32_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src)) setPreview({ id: postId, revision, epoch: identity.epoch, src });
      } catch { /* Retain safe decorative background on any failure. */ }
    })();
    return () => { active = false; };
  }, [postId, revision, session.epoch]);
  if (!preview || preview.id !== postId || preview.revision !== revision || preview.epoch !== session.epoch || !getFollowIdentity()) return null;
  // The downloaded bytes are already irreversibly reduced and blurred. Removing
  // styles cannot reveal original detail. No CSS privacy/filter assumption.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={preview.src} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover" draggable={false} />;
}
