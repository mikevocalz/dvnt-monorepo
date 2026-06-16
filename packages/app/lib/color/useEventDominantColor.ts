/**
 * useEventDominantColor — the one hook screens/components use for an event's
 * dominant color. The platform extractor split is invisible here.
 *
 *   { color, source: 'db' | 'extracted' | 'fallback', isLoading }
 *
 * - event.dominant_color set  → return it (`db`), zero work, no extraction.
 * - else                      → extract on-device (still flyer → direct; video →
 *                               thumbnail frame), return `extracted` for the UI,
 *                               and write it back via set-event-color so every
 *                               future viewer reads it from the column.
 * - failure                   → brand fallback gradient (`fallback`), never crash.
 *
 * Extraction never blocks render (effect + local state). A module-level cache +
 * in-flight promise map dedupe across simultaneous mounts, so N viewers of the
 * same event do ONE extraction and ONE write-back (first-writer-wins; the edge fn
 * is idempotent regardless).
 */
import { useEffect, useState } from "react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { extractDominantColor } from "./extractDominantColor";
import { FALLBACK_COLOR, normalizeHex, type ExtractInput } from "./normalizeColor";

export interface UseEventColorInput extends ExtractInput {
  /** Numeric event id — required for write-back; omit for read-only/local use. */
  eventId?: number | string | null;
  /** events.dominant_color, if already set. */
  dominantColor?: string | null;
}

export type ColorSource = "db" | "extracted" | "fallback";
export interface EventColor {
  color: string;
  source: ColorSource;
  isLoading: boolean;
}

// Resolved extractions (hex or null=failed), keyed so repeat mounts skip work.
const resolved = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const wroteBack = new Set<string>();

function keyFor(input: UseEventColorInput): string {
  return String(input.eventId ?? input.imageUrl ?? input.videoUrl ?? "");
}

async function writeBack(eventId: number | string, color: string): Promise<void> {
  const k = String(eventId);
  if (wroteBack.has(k)) return;
  wroteBack.add(k);
  try {
    await supabase.functions.invoke("set-event-color", {
      body: { event_id: Number(eventId), color },
    });
  } catch {
    wroteBack.delete(k); // let a later viewer retry
  }
}

function extractOnce(key: string, input: UseEventColorInput): Promise<string | null> {
  if (resolved.has(key)) return Promise.resolve(resolved.get(key)!);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = extractDominantColor({ imageUrl: input.imageUrl, videoUrl: input.videoUrl })
    .then((raw) => {
      const hex = normalizeHex(raw);
      resolved.set(key, hex);
      if (hex && input.eventId != null) void writeBack(input.eventId, hex);
      return hex;
    })
    .catch(() => {
      resolved.set(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

export function useEventDominantColor(input: UseEventColorInput): EventColor {
  const dbColor = normalizeHex(input.dominantColor);
  const key = keyFor(input);
  const hasMedia = !!(input.imageUrl || input.videoUrl);

  const [state, setState] = useState<EventColor>(() => {
    if (dbColor) return { color: dbColor, source: "db", isLoading: false };
    const cached = resolved.get(key);
    if (cached) return { color: cached, source: "extracted", isLoading: false };
    return { color: FALLBACK_COLOR, source: "fallback", isLoading: hasMedia };
  });

  useEffect(() => {
    // DB color wins — never extract or refetch when it's set.
    if (dbColor) {
      setState({ color: dbColor, source: "db", isLoading: false });
      return;
    }
    if (!hasMedia) {
      setState({ color: FALLBACK_COLOR, source: "fallback", isLoading: false });
      return;
    }
    let alive = true;
    const cached = resolved.get(key);
    if (cached !== undefined) {
      setState(
        cached
          ? { color: cached, source: "extracted", isLoading: false }
          : { color: FALLBACK_COLOR, source: "fallback", isLoading: false },
      );
      return;
    }
    setState((s) => (s.source === "extracted" ? s : { color: FALLBACK_COLOR, source: "fallback", isLoading: true }));
    extractOnce(key, input).then((hex) => {
      if (!alive) return;
      setState(
        hex
          ? { color: hex, source: "extracted", isLoading: false }
          : { color: FALLBACK_COLOR, source: "fallback", isLoading: false },
      );
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dbColor, input.imageUrl, input.videoUrl, hasMedia]);

  return state;
}
