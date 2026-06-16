"use client";
/**
 * WhoAllOverThere (web) — "Who All Over There 👀" ephemeral event-moment tray,
 * the web port of ../deviant/src/events/ui/WhoAllOverThere.tsx. Ticket holders +
 * hosts post photo/≤30s-video moments that expire 24h after the event; everyone
 * sees the tray and a fullscreen viewer.
 *
 * Backend is shared with native: reads `event_moments` directly (RLS-visible),
 * uploads through the `media-upload` edge fn (multipart), then records the moment
 * via `create-event-moment`. Web swaps expo-image-picker for a file input and
 * expo-video-thumbnails for a <canvas> frame; the contract is identical.
 */
import { useCallback, useRef, useState } from "react";
import { Camera, Play, Flag, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";

const THUMB = 80;
const MAX_VIDEO_SECONDS = 30;

interface Moment {
  id: number;
  media_url: string;
  media_type: "photo" | "video";
  thumbnail_url: string | null;
  duration_sec: number | null;
  created_at: string;
}

function formatDuration(sec: number | null): string | null {
  if (sec == null || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function fetchMoments(eventId: string): Promise<Moment[]> {
  const evId = parseInt(eventId);
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("event_moments")
    .select("id, media_url, media_type, thumbnail_url, duration_sec, created_at")
    .eq("event_id", evId)
    .gt("expires_at", now)
    .eq("is_flagged", false)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) {
    // thumbnail_url column may be absent on an un-migrated env — degrade.
    const { data: data2 } = await supabase
      .from("event_moments")
      .select("id, media_url, media_type, duration_sec, created_at")
      .eq("event_id", evId)
      .gt("expires_at", now)
      .eq("is_flagged", false)
      .order("created_at", { ascending: false })
      .limit(30);
    return (data2 || []).map((m) => ({ ...m, thumbnail_url: null })) as Moment[];
  }
  return (data || []) as Moment[];
}

function useMoments(eventId: string) {
  return useQuery({
    queryKey: ["event-moments", eventId],
    queryFn: () => fetchMoments(eventId),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });
}

/** Upload a File through the media-upload edge fn → returns the public URL. */
async function uploadMomentMedia(file: File | Blob, isVideo: boolean): Promise<string> {
  const token = await requireBetterAuthToken();
  if (!token) throw new Error("Sign in to post a moment.");
  const fd = new FormData();
  const name = file instanceof File ? file.name : isVideo ? "moment.mp4" : "moment.jpg";
  const mime = file.type || (isVideo ? "video/mp4" : "image/jpeg");
  fd.append("file", file, name);
  fd.append("kind", isVideo ? "event-moment-video" : "event-moment-photo");
  fd.append("mime", mime);
  const { data, error } = await supabase.functions.invoke("media-upload", {
    body: fd,
    headers: { Authorization: `Bearer ${token}`, "x-auth-token": token },
  });
  if (error) throw new Error(error.message || "Upload failed");
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  if (!parsed?.ok || !parsed?.media?.url) throw new Error(parsed?.error || "Upload failed");
  return parsed.media.url as string;
}

/** Read a video file's duration + grab a frame (for the tray thumbnail). */
function readVideoMeta(
  file: File,
): Promise<{ duration: number; thumb: Blob | null }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that video."));
    };
    video.onerror = fail;
    video.onloadedmetadata = () => {
      const duration = video.duration || 0;
      // Seek a touch in for a non-black frame, then snapshot to canvas.
      const grab = () => {
        try {
          const w = video.videoWidth, h = video.videoHeight;
          const scale = Math.min(1, 480 / Math.max(w || 1, h || 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round((w || 1) * scale));
          canvas.height = Math.max(1, Math.round((h || 1) * scale));
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);
              resolve({ duration, thumb: blob });
            },
            "image/jpeg",
            0.7,
          );
        } catch {
          URL.revokeObjectURL(url);
          resolve({ duration, thumb: null });
        }
      };
      video.onseeked = grab;
      try {
        video.currentTime = Math.min(1, duration / 2);
      } catch {
        grab();
      }
    };
  });
}

function MomentThumb({ moment, onPress }: { moment: Moment; onPress: () => void }) {
  const dur = formatDuration(moment.duration_sec);
  const isVideo = moment.media_type === "video";
  return (
    <button
      onClick={onPress}
      className="relative shrink-0 overflow-hidden rounded-xl bg-white/[0.06]"
      style={{ width: THUMB, height: THUMB }}
      aria-label={isVideo ? "Play moment" : "View moment"}
    >
      {isVideo && !moment.thumbnail_url ? (
        <video
          src={moment.media_url}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={moment.thumbnail_url || moment.media_url}
          alt=""
          className="h-full w-full object-cover"
        />
      )}
      {isVideo ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Play size={20} color="#fff" fill="#fff" />
        </span>
      ) : null}
      {dur ? (
        <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">
          {dur}
        </span>
      ) : null}
    </button>
  );
}

function MomentViewer({
  moments,
  index,
  onClose,
  onIndex,
}: {
  moments: Moment[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const [reported, setReported] = useState(false);
  const m = moments[index];
  if (!m) return null;
  const prev = () => onIndex((index - 1 + moments.length) % moments.length);
  const next = () => onIndex((index + 1) % moments.length);
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
      >
        <X size={20} color="#fff" />
      </button>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[86vh] max-w-[92vw]">
        {m.media_type === "video" ? (
          <video
            key={m.id}
            src={m.media_url}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-[86vh] max-w-[92vw] rounded-2xl"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={m.id}
            src={m.media_url}
            alt=""
            className="max-h-[86vh] max-w-[92vw] rounded-2xl object-contain"
          />
        )}
      </div>
      {moments.length > 1 ? (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); prev(); }}
            aria-label="Previous"
            className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <ChevronLeft size={22} color="#fff" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next(); }}
            aria-label="Next"
            className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white"
          >
            <ChevronRight size={22} color="#fff" />
          </button>
        </>
      ) : null}
      <button
        onClick={(e) => { e.stopPropagation(); setReported(true); }}
        className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white/80"
      >
        <Flag size={15} color="#fff" />
        {reported ? "Reported — thanks" : "Report"}
      </button>
    </div>
  );
}

export function WhoAllOverThere({
  eventId,
  canUpload,
}: {
  eventId: string;
  canUpload: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: moments = [], isLoading } = useMoments(eventId);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const createMoment = useMutation({
    mutationFn: async (vars: {
      mediaUrl: string;
      mediaType: "photo" | "video";
      durationSec?: number;
      thumbnailUrl?: string;
    }) => {
      const result = await invokeEdge("create-event-moment", {
        eventId: parseInt(eventId),
        mediaUrl: vars.mediaUrl,
        mediaType: vars.mediaType,
        durationSec: vars.durationSec,
        thumbnailUrl: vars.thumbnailUrl,
      });
      if (result.error) throw new Error(result.error.message);
      return result.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["event-moments", eventId] }),
  });

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      const isVideo = file.type.startsWith("video/");
      const isImage = file.type.startsWith("image/");
      if (!isVideo && !isImage) {
        setError("Pick a photo or video.");
        return;
      }
      setUploading(true);
      try {
        let durationSec: number | undefined;
        let thumbnailUrl: string | undefined;
        if (isVideo) {
          const { duration, thumb } = await readVideoMeta(file);
          if (duration > MAX_VIDEO_SECONDS + 1) {
            throw new Error(`Videos must be ${MAX_VIDEO_SECONDS}s or less.`);
          }
          durationSec = Math.round(duration);
          if (thumb) {
            try {
              thumbnailUrl = await uploadMomentMedia(thumb, false);
            } catch {
              /* thumbnail is best-effort */
            }
          }
        }
        const mediaUrl = await uploadMomentMedia(file, isVideo);
        await createMoment.mutateAsync({
          mediaUrl,
          mediaType: isVideo ? "video" : "photo",
          durationSec,
          thumbnailUrl,
        });
      } catch (err: any) {
        setError(err?.message || "Upload failed.");
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    [createMoment],
  );

  // Hide entirely when there's nothing to show and the viewer can't contribute.
  if (!isLoading && moments.length === 0 && !canUpload) return null;

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-bold">Who All Over There 👀</h2>
        {moments.length > 0 ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-semibold text-white/70">
            {moments.length}
          </span>
        ) : null}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {canUpload ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <button
              onClick={() => !uploading && fileRef.current?.click()}
              disabled={uploading}
              className="flex shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[#8A40CF]/60 bg-[#8A40CF]/10 text-[#cba6ef] disabled:opacity-60"
              style={{ width: THUMB, height: THUMB }}
            >
              {uploading ? (
                <span className="text-[11px] font-semibold">Uploading…</span>
              ) : (
                <>
                  <Camera size={20} color="#8A40CF" />
                  <span className="text-[11px] font-semibold">Add</span>
                </>
              )}
            </button>
          </>
        ) : null}

        {moments.map((m, i) => (
          <MomentThumb key={m.id} moment={m} onPress={() => setViewerIndex(i)} />
        ))}
      </div>

      {error ? <p className="mt-2 text-sm text-[#FC253A]">{error}</p> : null}

      {!isLoading && moments.length === 0 ? (
        <div className="mt-1 flex items-center gap-3 rounded-2xl bg-white/[0.04] p-4">
          <span className="text-2xl">📸</span>
          <div>
            <div className="text-sm font-semibold">No moments yet</div>
            <div className="text-sm text-white/55">
              {canUpload
                ? "Be the first to share a moment from this event"
                : "Ticket holders can post moments here"}
            </div>
          </div>
        </div>
      ) : null}

      {viewerIndex >= 0 && moments.length > 0 ? (
        <MomentViewer
          moments={moments}
          index={Math.min(viewerIndex, moments.length - 1)}
          onClose={() => setViewerIndex(-1)}
          onIndex={setViewerIndex}
        />
      ) : null}
    </section>
  );
}
