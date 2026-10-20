"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import type { MediaAsset } from "../../lib/hooks/use-media-picker";
import { videoLimitsLabel } from "../../lib/media/video-pick-policy";
import { MAX_BROWSER_POST_MEDIA } from "./browser-live-photo-import";
import {
  associateBrowserMedia,
  BROWSER_MEDIA_ACCEPT,
  MAX_BROWSER_REVIEW_FILES,
  mergeByAppleContentId,
  readBrowserMediaFiles,
  releaseUnselectedBrowserMedia,
  separateBrowserMedia,
  type BrowserPairedMedia,
} from "./browser-media-intake";

interface Props {
  selectedMedia: readonly MediaAsset[];
  draftIdentity: readonly unknown[];
  disabled: boolean;
  beginUpdate: () => (media: MediaAsset[]) => boolean;
  /** Synchronous event notification: the parent's submit guard must use a ref. */
  onPendingChange: (pending: boolean) => void;
  columns?: number;
}

/** One file entry for ordinary media and user-associated Live Photo originals. */
export function BrowserMediaPicker({ selectedMedia, draftIdentity, disabled, beginUpdate, onPendingChange, columns = 2 }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changePending = (label: string | null) => {
    onPendingChange(label !== null);
    setPending(label);
  };
  const invalidate = () => { version.current += 1; changePending(null); };
  const notifyExternalPending = useEffectEvent((value: boolean) => onPendingChange(value));
  useEffect(() => {
    // Synchronize the reader lifecycle with an externally replaced draft.
    version.current += 1;
    notifyExternalPending(false);
    setPending(null);
    return () => { version.current += 1; notifyExternalPending(false); };
  }, [selectedMedia, draftIdentity, disabled]);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length || disabled) return;
    invalidate(); setError(null);
    if (selectedMedia.length + files.length > MAX_BROWSER_REVIEW_FILES) {
      setError(`Choose no more than ${MAX_BROWSER_REVIEW_FILES} files for review. Pair or remove items before adding more; each published post can contain ${MAX_BROWSER_POST_MEDIA} items.`);
      return;
    }
    const operation = ++version.current;
    const commit = beginUpdate();
    const original = selectedMedia;
    changePending("Checking selected files…");
    try {
      const result = await readBrowserMediaFiles(files, { isCurrent: () => operation === version.current });
      if (operation !== version.current) { releaseUnselectedBrowserMedia(result.assets, original); return; }
      if (result.errors.length) {
        releaseUnselectedBrowserMedia(result.assets, original);
        setError(`These files were not added. Your existing items are unchanged.\n${result.errors.join("\n")}`);
      } else if (result.assets.length) {
        const merged = mergeByAppleContentId(original, result.assets);
        if (commit(merged.media)) {
          // Duplicates of a Live Photo already in the draft, and loose halves it replaced.
          releaseUnselectedBrowserMedia([...result.assets, ...merged.removed], merged.media);
        } else {
          releaseUnselectedBrowserMedia(result.assets, original);
          setError("Your draft changed while these files were checked. Please choose them again.");
        }
      }
    } catch {
      if (operation === version.current) setError("Could not read those files. Your existing items are unchanged; choose the files again to retry.");
    } finally {
      if (operation === version.current) changePending(null);
    }
  };

  const associate = async (stillId: string, motionId: string) => {
    if (disabled) return;
    invalidate(); setError(null);
    const commit = beginUpdate();
    if (!motionId) {
      const result = separateBrowserMedia(selectedMedia, stillId);
      if (!result.ok) { setError(result.message); return; }
      if (!commit(result.media)) setError("Your draft changed. Please try separating the pair again.");
      // Both originals now belong to separate cards. Neither URL is revoked.
      return;
    }
    const operation = ++version.current;
    changePending("Checking motion for this photo…");
    try {
      const result = await associateBrowserMedia(selectedMedia, stillId, motionId);
      if (operation !== version.current) return;
      if (!result.ok) { setError(result.message); return; }
      if (!commit(result.media)) setError("Your selection changed. Choose the matching motion again.");
      // A pair takes ownership of both source URLs; do not revoke either half.
    } catch {
      if (operation === version.current) setError("Could not read that motion. The files remain separate; choose the motion again to retry.");
    } finally {
      if (operation === version.current) changePending(null);
    }
  };

  const remove = (id: string) => {
    if (disabled) return;
    invalidate(); setError(null);
    const next = selectedMedia.filter(item => item.id !== id);
    if (beginUpdate()(next)) releaseUnselectedBrowserMedia(selectedMedia.filter(item => item.id === id), next);
  };
  const move = (index: number, direction: -1 | 1) => {
    if (disabled) return;
    const target = index + direction;
    if (target < 0 || target >= selectedMedia.length) return;
    invalidate(); setError(null);
    const next = [...selectedMedia];
    const [item] = next.splice(index, 1); next.splice(target, 0, item);
    beginUpdate()(next);
  };
  const clips = selectedMedia.filter(media => media.type === "video" && media.kind === "video");

  return <section className="mt-3" aria-label="Post media">
    <input ref={input} type="file" multiple hidden accept={BROWSER_MEDIA_ACCEPT} aria-label="Choose photos or videos" onChange={e => void pick(e)} />
    <button type="button" onClick={() => input.current?.click()} disabled={disabled || selectedMedia.length >= MAX_BROWSER_REVIEW_FILES}
      aria-describedby="browser-media-help" className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3.5 font-semibold text-white disabled:opacity-40">
      <ImagePlus size={20} />Add Photos or Videos
    </button>
    <p className="mt-2 text-xs text-white/45">{videoLimitsLabel("post-video")}. Up to {MAX_BROWSER_POST_MEDIA} items per post.</p>
    <p id="browser-media-help" className="mt-2 text-xs leading-5 text-white/60">
      To post a Live Photo from a Mac, open Photos and choose File &gt; Export &gt; Export Unmodified Original. Add both files it saves (the photo and the MOV) and they pair automatically. The Photos list in this file picker sends the still without its motion.
    </p>
    {selectedMedia.length > MAX_BROWSER_POST_MEDIA ? <p role="alert" className="mt-2 text-sm text-amber-200">
      {selectedMedia.length} files are in review. Pair matching photo and motion files, or remove items, to reach {MAX_BROWSER_POST_MEDIA} or fewer before sharing.
    </p> : null}
    {pending ? <div className="mt-3 flex items-center justify-between gap-3 text-sm text-cyan-200" data-browser-media-pending>
      <span role="status">{pending}</span><button type="button" onClick={() => { invalidate(); setError(null); }} className="underline">Cancel checking</button>
    </div> : null}
    {error ? <p role="alert" className="mt-3 whitespace-pre-line text-sm text-red-300">{error}</p> : null}
    {selectedMedia.length ? <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {selectedMedia.map((media, index) => {
        const paired = (media as BrowserPairedMedia).browserPair;
        const motionURI = media.kind === "livePhoto" ? media.pairedVideoUri : media.type === "video" ? media.uri : undefined;
        const name = media.fileName || `photo ${index + 1}`;
        return <div key={media.id} className="min-w-0 overflow-hidden rounded-2xl bg-[#111]" data-browser-media-id={media.id} data-browser-media-kind={media.kind}>
          <div className="relative aspect-[4/5]">
            {motionURI ? <video src={motionURI} poster={media.kind === "livePhoto" ? media.uri : undefined} controls muted loop playsInline preload="metadata"
              aria-label={`${media.kind === "livePhoto" ? "Live Photo" : "Video"} ${index + 1} motion preview`} className="h-full w-full object-cover" /> :
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.uri} alt={name} className="h-full w-full object-cover" />}
            <div className="absolute left-2 right-2 top-2 flex items-center justify-between gap-2">
              <button type="button" onClick={() => remove(media.id)} disabled={disabled} aria-label={`Remove ${name}`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/90 text-white disabled:opacity-30"><Trash2 size={14} /></button>
              {media.kind === "livePhoto" ? <span className="pointer-events-none rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold">LIVE</span> : null}
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-xs font-semibold">{index + 1}</span>
            </div>
          </div>
          <div className="space-y-2 p-2.5">
            <p className="truncate text-xs text-white/60" title={name}>{name}</p>
            {media.kind === "image" && clips.length > 0 || paired ? <label className="block text-xs text-white/70">Motion
              <select aria-label={`Motion for ${name}`} value={paired?.motion.id ?? ""} disabled={disabled}
                onChange={event => void associate(media.id, event.currentTarget.value)}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-[#1b1b1b] px-2 py-2 text-xs text-white">
                <option value="">{paired ? "None — separate photo and video" : "None — keep as photo"}</option>
                {paired ? <option value={paired.motion.id}>{paired.motion.fileName || "Selected motion"}</option> : clips.map((clip, clipIndex) => <option key={clip.id} value={clip.id}>{clip.fileName || `Video ${clipIndex + 1}`}</option>)}
              </select>
            </label> : null}
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`Move ${name} up`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 disabled:opacity-30"><ArrowUp size={14} /></button>
              <button type="button" onClick={() => move(index, 1)} disabled={disabled || index === selectedMedia.length - 1} aria-label={`Move ${name} down`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 disabled:opacity-30"><ArrowDown size={14} /></button>
            </div>
          </div>
        </div>;
      })}
    </div> : null}
  </section>;
}
