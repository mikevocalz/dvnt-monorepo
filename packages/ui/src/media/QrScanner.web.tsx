"use client";

import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

export interface QrScannerProps {
  /** Fires with the decoded text on a successful scan. */
  onScan: (text: string) => void;
  /** Optional error sink (per-frame decode misses are noisy — usually ignored). */
  onError?: (message: string) => void;
  /** Pause scanning after the first hit. Default true. */
  oneShot?: boolean;
}

/**
 * QR / barcode scanner (web) via `html5-qrcode` — the React-equivalent of the
 * native expo-camera barcode scanner (ticket check-in). Native sibling
 * (`QrScanner.tsx`) uses expo-camera's `onBarcodeScanned`.
 */
export function QrScanner({ onScan, onError, oneShot = true }: QrScannerProps) {
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

  return <div ref={elRef} className="w-full overflow-hidden rounded-2xl bg-black" />;
}
