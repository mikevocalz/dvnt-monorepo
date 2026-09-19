"use client";

import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface LegacyQrScannerProps {
  /** Fires with the decoded text on a successful scan. */
  onScan: (text: string) => void;
  /** Optional error sink (per-frame decode misses are noisy — usually ignored). */
  onError?: (message: string) => void;
  /** Pause scanning after the first hit. Default true. */
  oneShot?: boolean;
}

/**
 * QR / barcode scanner (web) via `html5-qrcode` — the implementation that ran
 * the door before the CameraView rewrite, kept for ONE release as a runtime
 * escape hatch.
 *
 * `?engine=legacy` on the scanner URL selects it, and every camera-issue panel
 * offers the switch. The point is that a door which cannot scan has a fix that
 * does not require a deploy — a Vercel rollback in a venue doorway, on venue
 * signal, is not a recovery plan.
 *
 * Imported statically, not lazily, for the same reason: the fallback has to be
 * already in the bundle at the moment the network is the thing that is broken.
 *
 * Delete this file, its prop plumbing and the html5-qrcode dependency in the
 * first PR after Saturday 2026-09-20.
 */
export function LegacyQrScanner({ onScan, onError, oneShot = true }: LegacyQrScannerProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!elRef.current) return;
    const id = "dvnt-qr-region";
    elRef.current.id = id;
    const scanner = new Html5Qrcode(id);
    scannerRef.current = scanner;
    let cancelled = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (oneShot && doneRef.current) return;
          doneRef.current = true;
          onScan(decoded);
        },
        (err) => onError?.(err),
      )
      .catch((e) => onError?.(String(e?.message ?? e)));

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
      void cancelled;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which engine is live, readable from the DOM. The door switches engines by
  // URL with no deploy, so "which one am I actually running" has to be
  // answerable from a phone someone hands you mid-shift.
  return (
    <div
      ref={elRef}
      data-qr-engine="legacy"
      // aspect-square, so a failed start() is a visible black panel the issue
      // text can sit against rather than a zero-height element. Without it,
      // html5-qrcode rejecting — a denied camera is the likeliest cause on
      // iOS — left the frame guide floating over literally nothing, which is
      // the "silent black box" the rewrite was supposed to remove and which
      // this component is the documented fallback FOR.
      className="aspect-square w-full overflow-hidden rounded-2xl bg-black"
    />
  );
}
