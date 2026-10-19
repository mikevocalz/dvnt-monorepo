"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaAsset } from "../../lib/hooks/use-media-picker";
import { sizeLimitForKind } from "../../lib/media/upload-policy";
import { videoLimitsLabel } from "../../lib/media/video-pick-policy";
import {
  createBrowserLivePhotoAsset,
  LIVE_PHOTO_STILL_ACCEPT,
  LIVE_PHOTO_VIDEO_ACCEPT,
  releaseBrowserMediaAsset,
  validateLivePhotoFiles,
} from "./browser-live-photo-import";

interface Props {
  disabled: boolean;
  selectionIdentity: readonly MediaAsset[];
  draftIdentity: readonly unknown[];
  beginAdd: () => (assets: MediaAsset[]) => boolean;
}

const fileClass = "block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white";

function usePreviewURL(file: File | null): string | undefined {
  const [url, setURL] = useState<string>();
  useEffect(() => {
    const next = file ? URL.createObjectURL(file) : undefined;
    // This mirrors an external browser resource allocated only after commit,
    // so aborted/Strict Mode renders cannot leak object URLs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setURL(next);
    return () => { if (next) URL.revokeObjectURL(next); };
  }, [file]);
  return url;
}

/** Explicit one-photo + one-video import. Repeat to build a Live Photo carousel. */
export function LivePhotoPairPicker({ disabled, selectionIdentity, draftIdentity, beginAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [still, setStill] = useState<File | null>(null);
  const [motion, setMotion] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [stillPreviewError, setStillPreviewError] = useState(false);
  const version = useRef(0);
  const stillURL = usePreviewURL(still);
  const motionURL = usePreviewURL(motion);
  const clear = () => {
    version.current += 1;
    setOpen(false); setStill(null); setMotion(null); setChecking(false); setError(null); setPreviewError(false); setPreviewReady(false); setStillPreviewError(false);
  };
  useEffect(() => {
    clear();
    return () => { version.current += 1; };
  }, [selectionIdentity, draftIdentity, disabled]);

  useEffect(() => {
    if (!motionURL || previewReady) return;
    const timer = setTimeout(() => setPreviewError(true), 10_000);
    return () => clearTimeout(timer);
  }, [motionURL, previewReady, previewAttempt]);

  const changeFile = (part: "still" | "motion", file: File | null) => {
    // Cancelling the OS picker retains the already chosen half of the pair.
    if (!file) return;
    version.current += 1;
    setChecking(false); setError(null);
    if (part === "still") { setStill(file); setStillPreviewError(false); }
    else { setMotion(file); setPreviewError(false); setPreviewReady(false); }
  };
  const add = async () => {
    if (checking || disabled || !previewReady || previewError) return;
    const invalid = validateLivePhotoFiles(still, motion);
    if (invalid) { setError(invalid.message); return; }
    const operation = ++version.current;
    const commit = beginAdd();
    setChecking(true); setError(null);
    try {
      const result = await createBrowserLivePhotoAsset(still!, motion!);
      if (operation !== version.current) {
        if (result.ok) releaseBrowserMediaAsset(result.asset);
        return;
      }
      if (!result.ok) { setError(result.message); return; }
      if (!commit([result.asset])) {
        releaseBrowserMediaAsset(result.asset);
        setError("Your selection changed while this pair was checked. Review your post and add the pair again.");
        return;
      }
      // Preview URLs can go away; committed asset URLs belong to the draft and
      // publish queue, which may still be uploading after this panel unmounts.
      clear();
    } catch {
      if (operation === version.current) setError("Could not read this pair. Choose the original files and try again.");
    } finally {
      if (operation === version.current) setChecking(false);
    }
  };

  return <section className="mt-3" aria-label="Live Photo import">
    <button type="button" disabled={disabled} onClick={() => { if (open) clear(); else setOpen(true); }}
      className="w-full rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-3 text-sm font-semibold text-cyan-200 disabled:opacity-40"
      aria-expanded={open} aria-controls="live-photo-pair-panel">Add Live Photo</button>
    <p id="live-photo-upload-help" className="mt-2 text-xs leading-5 text-white/60">
      A browser photo picker may give you only the still. To keep motion, use Add Live Photo and select the original photo and its matching MOV or MP4. Add each pair separately to build a carousel.
    </p>
    {open ? <div id="live-photo-pair-panel" className="mt-3 space-y-3 rounded-xl border border-white/15 bg-white/4 p-3">
      <p className="text-sm text-white/80">Choose both files from the same Live Photo. They become one carousel item. File names are not used to match them.</p>
      <label className="block text-sm font-medium">1. Still photo
        <input type="file" accept={LIVE_PHOTO_STILL_ACCEPT} className={`${fileClass} mt-2`}
          onChange={e => changeFile("still", e.currentTarget.files?.[0] ?? null)} />
      </label>
      {still ? <p className="break-all text-xs text-white/60">Photo: {still.name}</p> : null}
      <label className="block text-sm font-medium">2. Matching motion file
        <input type="file" accept={LIVE_PHOTO_VIDEO_ACCEPT} className={`${fileClass} mt-2`}
          onChange={e => changeFile("motion", e.currentTarget.files?.[0] ?? null)} />
      </label>
      {motion ? <p className="break-all text-xs text-white/60">Motion: {motion.name}</p> : null}
      <p className="text-xs leading-5 text-white/45">Still up to {Math.round(sizeLimitForKind("post-image") / (1024 * 1024))}MB. {videoLimitsLabel("post-video")}.</p>
      {motionURL ? <video key={`${motionURL}-${previewAttempt}`} src={motionURL} poster={stillURL} controls muted playsInline loop preload="auto"
        aria-label="Live Photo motion preview" className="max-h-64 w-full rounded-xl bg-black object-contain"
        onLoadedData={e => {
          const video = e.currentTarget;
          if (video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0) { setPreviewReady(true); setPreviewError(false); }
        }}
        onCanPlay={e => {
          const video = e.currentTarget;
          if (video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0) { setPreviewReady(true); setPreviewError(false); }
        }}
        onError={() => { setPreviewError(true); setPreviewReady(false); }} /> : stillURL ?
        // eslint-disable-next-line @next/next/no-img-element
        <img src={stillURL} alt="Selected Live Photo still" onError={() => setStillPreviewError(true)} className="max-h-64 w-full rounded-xl object-contain" /> : null}
      {stillPreviewError ? <p className="text-xs text-white/60">This browser cannot preview the still photo. Its original file is preserved; use the motion preview to check the pair.</p> : null}
      {motionURL && !previewReady && !previewError ? <p role="status" className="text-xs text-white/60">Checking that this browser can play the motion…</p> : null}
      {previewError ? <div role="alert" className="text-xs leading-5 text-amber-200">
        <p>This browser could not play the motion. Choose a compatible MOV or MP4 from this Live Photo, try a compatible browser, or upload with the iPhone app. Original files are not converted.</p>
        <button type="button" onClick={() => { setPreviewError(false); setPreviewReady(false); setPreviewAttempt(value => value + 1); }} className="mt-1 underline">Retry motion preview</button>
      </div> : null}
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" disabled={checking || disabled || !still || !motion || !previewReady || previewError} onClick={() => void add()}
          className="flex-1 rounded-xl bg-cyan-500 px-3 py-2.5 text-sm font-semibold disabled:opacity-40">{checking ? "Checking pair…" : "Add pair to post"}</button>
        <button type="button" onClick={clear} className="rounded-xl border border-white/15 px-3 py-2.5 text-sm">Cancel</button>
      </div>
    </div> : null}
  </section>;
}
