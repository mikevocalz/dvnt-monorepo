"use client";

/**
 * Records a screen view when you LEAVE a screen, so the row carries how long
 * you stayed rather than only that you arrived.
 *
 * Mount once, high in the tree, on each rail. Everything it needs is the
 * current pathname — no per-screen instrumentation to remember, and no screen
 * can be forgotten.
 */

import { useEffect, useRef } from "react";
import { Platform } from "react-native";

import { recordScreenView } from "./screen-views";

export function useScreenViewTracking(
  pathname: string | undefined,
  userId?: string | null,
) {
  // Refs, not state: this must never cause a render. Analytics that re-renders
  // the screen it measures is measuring itself.
  const currentRef = useRef<{ pathname: string; enteredAt: number } | null>(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  useEffect(() => {
    if (!pathname) return;
    const previous = currentRef.current;
    if (previous && previous.pathname !== pathname) {
      void recordScreenView({
        pathname: previous.pathname,
        durationMs: Date.now() - previous.enteredAt,
        userId: userIdRef.current,
        platform: Platform.OS,
      });
    }
    if (!previous || previous.pathname !== pathname) {
      currentRef.current = { pathname, enteredAt: Date.now() };
    }
  }, [pathname]);

  // The last screen of a session is the one people most want to know about —
  // it is where they stopped. Without this, every session loses its final row.
  const flush = useRef(() => {
    const open = currentRef.current;
    if (!open) return;
    void recordScreenView({
      pathname: open.pathname,
      durationMs: Date.now() - open.enteredAt,
      userId: userIdRef.current,
      platform: Platform.OS,
    });
    currentRef.current = null;
  });

  useEffect(() => flush.current, []);

  /**
   * On the web an unmount cleanup is NOT enough: a hard navigation, a tab
   * close or a swipe-back tears the page down without running effects, so the
   * final screen of every session was lost — the exact row that says where
   * people stop. `visibilitychange -> hidden` fires before that teardown and
   * is the last reliable moment to write.
   */
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onHide = () => {
      if (document.visibilityState === "hidden") flush.current();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush.current);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush.current);
    };
  }, []);
}
