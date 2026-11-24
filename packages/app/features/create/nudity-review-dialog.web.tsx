"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { NudityReview } from "./nudity-review-policy";

export function NudityReviewDialog({ result, onCancel, onContinue }: {
  result: NudityReview; onCancel: () => void; onContinue: (spicy: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  const [useFallback, setUseFallback] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    try {
      if (!dialog || typeof dialog.showModal !== "function") setUseFallback(true);
      else dialog.showModal();
    } catch {
      setUseFallback(true);
    }
    return () => {
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  useEffect(() => { if (useFallback) firstChoice.current?.focus(); }, [useFallback]);

  function onFallbackKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll("button");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  const choices = <>
    <h2 id="nudity-review-title" className="text-xl font-semibold">{result.flagged ? "Should this post be Spicy?" : "Review your media before sharing"}</h2>
    <p id="nudity-review-description" className="mt-3 text-sm text-white/75">
      {result.flagged ? "An on-device check found possible nudity or explicit content. Mark this post Spicy or go back and review your media." : "We couldn’t fully check this media. You can review it, mark it Spicy, or continue with your selected label."}
      {result.flagged && result.incomplete ? " Some media couldn’t be checked." : ""}
    </p>
    <p className="mt-3 text-xs text-white/55">This check runs in your browser, not on a third-party service. It can make mistakes. Videos use sampled frames, not a complete review.</p>
    <div className="mt-5 flex flex-col gap-2">
      <button ref={firstChoice} type="button" autoFocus onClick={onCancel} className="rounded-xl border border-white/20 px-4 py-3">Review draft</button>
      <button type="button" onClick={() => onContinue(true)} className="rounded-xl bg-cyan-500 px-4 py-3 font-semibold text-black">Mark Spicy and share</button>
      <button type="button" onClick={() => onContinue(false)} className="rounded-xl px-4 py-3 text-sm text-white/70">{result.flagged ? "This is a mistake: share as Sweet" : "Share with current label"}</button>
    </div>
  </>;
  const labels = { "aria-labelledby": "nudity-review-title", "aria-describedby": "nudity-review-description" };
  const panel = "w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#11131c] p-6 text-white";
  if (useFallback) return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75">
      <div role="dialog" aria-modal="true" {...labels} onKeyDown={onFallbackKey}
        className={panel} style={{ maxHeight: "calc(100% - 2rem)" }}>{choices}</div>
    </div>,
    document.body,
  );
  return <dialog ref={ref} {...labels} onCancel={onCancel}
    className={panel + " max-h-[calc(100dvh-2rem)] backdrop:bg-black/75"}>{choices}</dialog>;
}
