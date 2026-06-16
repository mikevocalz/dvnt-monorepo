/**
 * VideoLifecycleManager - Crash-proof video lifecycle utilities
 *
 * Root cause of EXC_BAD_ACCESS crashes:
 * - AVPlayer replaceCurrentItemWithPlayerItem called after component unmount
 * - expo-video's useVideoPlayer creates native AVPlayer that persists beyond React lifecycle
 * - When component unmounts, player.replace() or player.play() on released object = SIGSEGV
 *
 * Solution:
 * - Track mount state with isMountedRef
 * - Guard ALL player operations with mount check
 * - Cancel pending operations on unmount
 * - Log all lifecycle events for debugging
 */

import { useRef, useEffect, useCallback } from "react";
import type { VideoPlayer } from "expo-video";

// Global debug flag - set to true to see all video lifecycle logs
const VIDEO_DEBUG = __DEV__;

// Track active video instances globally to detect double-mounts
const activeVideoInstances = new Map<string, number>();

export interface VideoLifecycleState {
  isMounted: boolean;
  isExiting: boolean;
  instanceId: string;
  mountTime: number;
}

/**
 * Logs video lifecycle events with consistent formatting
 */
export function logVideoHealth(
  component: string,
  event: string,
  details?: Record<string, unknown>,
) {
  if (!VIDEO_DEBUG) return;

  if (!__DEV__) return;
  const timestamp = Date.now();
  const detailsStr = details ? ` ${JSON.stringify(details)}` : "";
  // Only log non-routine events (skip OK getCurrentTime/getDuration spam)
  if (event.startsWith("OK getCurrent") || event.startsWith("OK getDuration"))
    return;
  console.log(`[VideoHealth:${component}] ${event}${detailsStr} @${timestamp}`);
}

/**
 * Safe wrapper for player operations that checks mount state
 */
export function safePlayerOp<T>(
  isMountedRef: React.MutableRefObject<boolean>,
  player: VideoPlayer | null,
  operation: (p: VideoPlayer) => T,
  fallback: T,
  opName: string,
  componentName: string,
): T {
  if (!isMountedRef.current) {
    logVideoHealth(componentName, `BLOCKED ${opName} - unmounted`);
    return fallback;
  }

  if (!player) {
    logVideoHealth(componentName, `BLOCKED ${opName} - no player`);
    return fallback;
  }

  try {
    const result = operation(player);
    logVideoHealth(componentName, `OK ${opName}`);
    return result;
  } catch (error: unknown) {
    // ERR_USING_RELEASED_SHARED_OBJECT is expected when player is released
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "ERR_USING_RELEASED_SHARED_OBJECT"
    ) {
      logVideoHealth(componentName, `EXPECTED ${opName} - player released`);
      return fallback;
    }

    logVideoHealth(componentName, `ERROR ${opName}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

/**
 * Hook that provides video lifecycle management
 * Returns refs and utilities for safe video operations
 */
export function useVideoLifecycle(componentName: string, videoId?: string) {
  const isMountedRef = useRef(true);
  const isExitingRef = useRef(false);
  const instanceIdRef = useRef(
    `${componentName}-${videoId || "unknown"}-${Date.now()}`,
  );
  const pendingTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );
  const pendingIntervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(
    new Set(),
  );

  // Track mount/unmount
  useEffect(() => {
    const instanceId = instanceIdRef.current;
    isMountedRef.current = true;
    isExitingRef.current = false;

    // Track active instances
    const currentCount = activeVideoInstances.get(componentName) || 0;
    activeVideoInstances.set(componentName, currentCount + 1);

    logVideoHealth(componentName, "MOUNT", {
      instanceId,
      activeCount: currentCount + 1,
      videoId,
    });

    // Warn on potential double-mount
    if (currentCount > 0) {
      logVideoHealth(componentName, "WARNING: Multiple instances active", {
        count: currentCount + 1,
      });
    }

    return () => {
      isMountedRef.current = false;
      isExitingRef.current = true;

      // Clear all pending timers
      pendingTimersRef.current.forEach((timer) => clearTimeout(timer));
      pendingTimersRef.current.clear();

      // Clear all pending intervals
      pendingIntervalsRef.current.forEach((interval) =>
        clearInterval(interval),
      );
      pendingIntervalsRef.current.clear();

      // Update active count
      const count = activeVideoInstances.get(componentName) || 1;
      if (count <= 1) {
        activeVideoInstances.delete(componentName);
      } else {
        activeVideoInstances.set(componentName, count - 1);
      }

      logVideoHealth(componentName, "UNMOUNT", {
        instanceId,
        remainingCount: Math.max(0, count - 1),
      });
    };
  }, [componentName, videoId]);

  // Safe setTimeout that auto-cancels on unmount
  const safeTimeout = useCallback(
    (callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
      const timer = setTimeout(() => {
        pendingTimersRef.current.delete(timer);
        if (isMountedRef.current && !isExitingRef.current) {
          callback();
        }
      }, delay);
      pendingTimersRef.current.add(timer);
      return timer;
    },
    [],
  );

  // Safe setInterval that auto-cancels on unmount
  const safeInterval = useCallback(
    (callback: () => void, delay: number): ReturnType<typeof setInterval> => {
      const interval = setInterval(() => {
        if (isMountedRef.current && !isExitingRef.current) {
          callback();
        }
      }, delay);
      pendingIntervalsRef.current.add(interval);
      return interval;
    },
    [],
  );

  // Clear a specific timer
  const clearSafeTimeout = useCallback(
    (timer: ReturnType<typeof setTimeout>) => {
      clearTimeout(timer);
      pendingTimersRef.current.delete(timer);
    },
    [],
  );

  // Clear a specific interval
  const clearSafeInterval = useCallback(
    (interval: ReturnType<typeof setInterval>) => {
      clearInterval(interval);
      pendingIntervalsRef.current.delete(interval);
    },
    [],
  );

  // Mark as exiting (for navigation away)
  const markExiting = useCallback(() => {
    isExitingRef.current = true;
    logVideoHealth(componentName, "MARK_EXITING");
  }, [componentName]);

  // Check if safe to perform operations
  const isSafeToOperate = useCallback(() => {
    return isMountedRef.current && !isExitingRef.current;
  }, []);

  return {
    isMountedRef,
    isExitingRef,
    instanceId: instanceIdRef.current,
    safeTimeout,
    safeInterval,
    clearSafeTimeout,
    clearSafeInterval,
    markExiting,
    isSafeToOperate,
  };
}

/**
 * Safe player play - guards against unmount
 */
export function safePlay(
  player: VideoPlayer | null,
  isMountedRef: React.MutableRefObject<boolean>,
  componentName: string,
): boolean {
  return safePlayerOp(
    isMountedRef,
    player,
    (p) => {
      p.play();
      return true;
    },
    false,
    "play",
    componentName,
  );
}

/**
 * Safe player pause - guards against unmount
 */
export function safePause(
  player: VideoPlayer | null,
  isMountedRef: React.MutableRefObject<boolean>,
  componentName: string,
): boolean {
  return safePlayerOp(
    isMountedRef,
    player,
    (p) => {
      p.pause();
      return true;
    },
    false,
    "pause",
    componentName,
  );
}

/**
 * Safe player seek - guards against unmount
 */
export function safeSeek(
  player: VideoPlayer | null,
  isMountedRef: React.MutableRefObject<boolean>,
  time: number,
  componentName: string,
): boolean {
  return safePlayerOp(
    isMountedRef,
    player,
    (p) => {
      p.currentTime = time;
      return true;
    },
    false,
    `seek(${time})`,
    componentName,
  );
}

/**
 * Safe player mute - guards against unmount
 */
export function safeMute(
  player: VideoPlayer | null,
  isMountedRef: React.MutableRefObject<boolean>,
  muted: boolean,
  componentName: string,
): boolean {
  return safePlayerOp(
    isMountedRef,
    player,
    (p) => {
      p.muted = muted;
      return true;
    },
    false,
    `mute(${muted})`,
    componentName,
  );
}

/**
 * Safe get current time - guards against unmount
 */
export function safeGetCurrentTime(
  player: VideoPlayer | null,
  isMountedRef: React.MutableRefObject<boolean>,
  componentName: string,
): number {
  return safePlayerOp(
    isMountedRef,
    player,
    (p) => p.currentTime || 0,
    0,
    "getCurrentTime",
    componentName,
  );
}

/**
 * Safe get duration - guards against unmount
 */
export function safeGetDuration(
  player: VideoPlayer | null,
  isMountedRef: React.MutableRefObject<boolean>,
  componentName: string,
): number {
  return safePlayerOp(
    isMountedRef,
    player,
    (p) => p.duration || 0,
    0,
    "getDuration",
    componentName,
  );
}

/**
 * Cleanup player safely on unmount
 */
export function cleanupPlayer(
  player: VideoPlayer | null,
  componentName: string,
): void {
  if (!player) return;

  try {
    player.pause();
    player.currentTime = 0;
    logVideoHealth(componentName, "CLEANUP OK");
  } catch (error) {
    // Expected if player already released
    logVideoHealth(componentName, "CLEANUP - player already released");
  }
}

/**
 * Get active video instance count for debugging
 */
export function getActiveVideoCount(): Map<string, number> {
  return new Map(activeVideoInstances);
}
