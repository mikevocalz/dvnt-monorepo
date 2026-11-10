"use client";
import { useEffect, useRef } from "react";
import type { NudityReview } from "./nudity-review-policy";

export function NudityReviewDialog({ result, onCancel, onContinue }: {
  result: NudityReview; onCancel: () => void; onContinue: (spicy: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} aria-labelledby="nudity-review-title" aria-describedby="nudity-review-description"
    onCancel={onCancel} className="w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/15 bg-[#11131c] p-6 text-white backdrop:bg-black/75">
    <h2 id="nudity-review-title" className="text-xl font-semibold">{result.flagged ? "Should this post be Spicy?" : "Review your media before sharing"}</h2>
    <p id="nudity-review-description" className="mt-3 text-sm text-white/75">
      {result.flagged ? "An on-device check found possible nudity or explicit content. Mark this post Spicy or go back and review your media." : "We couldn’t fully check this media. You can review it, mark it Spicy, or continue with your selected label."}
      {result.flagged && result.incomplete ? " Some media couldn’t be checked." : ""}
    </p>
    <p className="mt-3 text-xs text-white/55">This check runs in your browser, not on a third-party service. It can make mistakes. Videos use sampled frames, not a complete review.</p>
    <div className="mt-5 flex flex-col gap-2">
      <button autoFocus onClick={onCancel} className="rounded-xl border border-white/20 px-4 py-3">Review draft</button>
      <button onClick={() => onContinue(true)} className="rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-black">Mark Spicy and share</button>
      <button onClick={() => onContinue(false)} className="rounded-xl px-4 py-3 text-sm text-white/70">{result.flagged ? "This is a mistake: share as Sweet" : "Share with current label"}</button>
    </div>
  </dialog>;
}
