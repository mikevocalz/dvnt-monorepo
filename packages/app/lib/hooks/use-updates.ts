/**
 * OTA Updates Hook
 *
 * Handles checking for and applying expo-updates.
 * CRITICAL: This hook must NEVER crash the app. All operations are wrapped
 * in try-catch blocks and failures are logged.
 *
 * DEDUPLICATION: Uses persistent storage to track which update IDs have been
 * shown/dismissed to prevent toast spam across app restarts.
 *
 * OTA PROMPT: Uses sonner-native toast with action/cancel buttons. Falls back
 * to native Alert if the toast system throws.
 *
 * To test OTA in development builds: set EXPO_PUBLIC_FORCE_OTA_CHECK=true.
 * Publish updates with: eas update --channel production
 *
 * STATE: All mutable state lives in useOtaUpdateStore (Zustand) — no useState.
 */

import { useCallback, useEffect } from "react";
import { Alert, AppState, type AppStateStatus, Platform } from "react-native";
import { toast } from "sonner-native";
import { mmkv } from "@dvnt/app/lib/mmkv-zustand";
import {
  useOtaUpdateStore,
  OTA_DISMISSED_STORAGE_KEY,
} from "@dvnt/app/lib/stores/ota-update-store";
import {
  isKnownBadUpdate,
  markUpdatePending,
} from "@dvnt/app/lib/ota/updateSafety";

const FORCE_OTA_IN_DEV =
  typeof process !== "undefined" &&
  process.env?.EXPO_PUBLIC_FORCE_OTA_CHECK === "true";

// SINGLETON: Module-level flags to prevent multiple hook instances from racing
let globalIsInitialized = false;
let globalIsChecking = false;
let globalIsDownloading = false;

// Dynamically import expo-updates to handle Expo Go where native module isn't available
let Updates: typeof import("expo-updates") | null = null;
let UpdatesAvailable = false;

try {
  if (Platform.OS !== "web") {
    Updates = require("expo-updates");
    UpdatesAvailable = true;
  }
} catch (error) {
  console.log("[Updates] expo-updates not available (Expo Go / web)");
}

// Safe property access helper
function safeGet<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * showUpdateToast — imperative (non-hook) helper.
 * Uses Zustand's getState() so it can be called from inside callbacks without
 * being a useCallback dependency or causing stale-closure issues.
 *
 * Guards:
 *  1. Phase must be "idle" — prevents duplicates within a session
 *  2. MMKV dismissed-ID check — prevents loops across cold restarts
 *
 * Uses sonner-native toast with action/cancel buttons. Falls back to Alert.
 * MUST show "Update Later" (cancel) + "Restart App Now" (action) per CLAUDE.md.
 */
function showUpdateToast(updateId?: string | null) {
  const store = useOtaUpdateStore.getState();

  // Guard 1: already shown or dismissed this session
  if (store.phase !== "idle") {
    console.log("[Updates] Toast suppressed — phase:", store.phase);
    return;
  }

  const currentId = updateId ?? null;

  // Guard 2: user already dismissed THIS exact update ID on a prior session
  if (currentId) {
    const dismissedId = safeGet(
      () => mmkv.getString(OTA_DISMISSED_STORAGE_KEY),
      null,
    );
    if (dismissedId === currentId) {
      console.log(
        "[Updates] Toast suppressed — already dismissed ID:",
        currentId,
      );
      return;
    }
  }

  store.setUpdateId(currentId);
  store.showBanner(); // marks phase "visible" for session dedup

  const handleDismiss = () => {
    store.dismiss(); // saves dismissedId to MMKV, sets phase "dismissed"
    console.log("[Updates] User dismissed update toast");
  };

  const handleApply = () => {
    store.apply(); // clears MMKV dismissed key, sets phase "applying"
    // IMPORTANT: Do NOT call reloadAsync() here.
    // On iOS 26.0.1 (and possibly other New Architecture builds), reloadAsync()
    // triggers a __cxa_pure_virtual abort in ShadowTree::tryCommit because the
    // old Fabric C++ vtable objects are still alive when the new bundle's first
    // frame render fires. Cold starts apply the cached OTA cleanly — so we
    // instruct the user to close and reopen instead.
    console.log("[Updates] User tapped install — showing manual close/reopen instructions (reloadAsync disabled: iOS 26 Fabric vtable bug)");
    try {
      Alert.alert(
        "Restart to Install",
        "Swipe up to close the app, then reopen it. The update will install automatically on relaunch.",
        [{ text: "OK", style: "default" }],
      );
    } catch (alertErr) {
      console.warn("[Updates] Alert failed:", alertErr);
    }
  };

  console.log("[Updates] Showing update toast for ID:", currentId);

  try {
    toast("Update Ready", {
      description: "A new version has been downloaded and is ready to install.",
      duration: Infinity,
      cancel: {
        label: "Update Later",
        onClick: handleDismiss,
      },
      action: {
        label: "How to Install",
        onClick: handleApply,
      },
    });
  } catch (toastErr) {
    console.warn("[Updates] toast() failed, falling back to Alert:", toastErr);
    Alert.alert(
      "Update Ready",
      "A new version has been downloaded and is ready to install.",
      [
        { text: "Update Later", style: "cancel", onPress: handleDismiss },
        { text: "How to Install", style: "default", onPress: handleApply },
      ],
    );
  }
}

export interface UseUpdatesOptions {
  /** If false, OTA checks will be deferred until enabled becomes true */
  enabled?: boolean;
}

export function useUpdates(options: UseUpdatesOptions = {}) {
  const { enabled = true } = options;

  const store = useOtaUpdateStore();

  useEffect(() => {
    console.log(
      "[Updates] Hook mounted — __DEV__:",
      __DEV__,
      "FORCE_OTA:",
      FORCE_OTA_IN_DEV,
      "UpdatesAvailable:",
      UpdatesAvailable,
      "globalInitialized:",
      globalIsInitialized,
      "enabled:",
      enabled,
    );
    if (Updates) {
      console.log(
        "[Updates] expo-updates loaded, isEnabled:",
        safeGet(() => Updates?.isEnabled, false),
      );
    }
  }, [enabled]);

  const reloadApp = useCallback(async () => {
    if (!Updates) return;
    try {
      await Updates.reloadAsync();
    } catch (e) {
      console.warn(
        "[Updates] reloadAsync failed (update applies on next cold start):",
        e,
      );
    }
  }, []);

  const downloadAndApplyUpdate = useCallback(async () => {
    const skipDev = __DEV__ && !FORCE_OTA_IN_DEV;
    if (skipDev || !Updates || !UpdatesAvailable) {
      if (skipDev)
        console.log(
          "[Updates] Skip download: __DEV__ (set EXPO_PUBLIC_FORCE_OTA_CHECK=true to test)",
        );
      return;
    }

    if (globalIsDownloading) return;
    globalIsDownloading = true;

    const isEnabled = safeGet(() => {
      if (typeof Updates?.isEnabled === "undefined") return false;
      return Updates.isEnabled;
    }, false);

    if (!isEnabled) {
      console.log("[Updates] Skip download: expo-updates not enabled");
      globalIsDownloading = false;
      return;
    }

    useOtaUpdateStore.getState().setDownloading(true);

    try {
      const result = await safeGet(
        () => Updates!.fetchUpdateAsync(),
        Promise.resolve({ isNew: false } as Awaited<
          ReturnType<typeof Updates.fetchUpdateAsync>
        >),
      );

      if (result && result.isNew) {
        useOtaUpdateStore.getState().setDownloading(false);
        useOtaUpdateStore.getState().setUpdatePending(true);
        const newUpdateId = safeGet(
          () => (result as any)?.manifest?.id || (result as any)?.updateId,
          null,
        );
        console.log(
          "[Updates] Update fetched, isNew: true, updateId:",
          newUpdateId,
        );
        // KILL-SWITCH: refuse to apply known-bad updates
        if (isKnownBadUpdate(newUpdateId)) {
          console.error(
            `[Updates] Update ${newUpdateId} is blacklisted (known-bad) — skipping apply`,
          );
          useOtaUpdateStore.getState().setUpdatePending(false);
          return;
        }
        showUpdateToast(newUpdateId);
      } else {
        console.log(
          "[Updates] Fetch complete, isNew:",
          !!(result && result.isNew),
        );
        useOtaUpdateStore.getState().setDownloading(false);
      }
    } catch (error) {
      console.error("[Updates] Download failed (non-fatal):", error);
      useOtaUpdateStore.getState().setDownloading(false);
      useOtaUpdateStore.getState().setCheckError(
        error instanceof Error ? error.message : "Failed to download update",
      );
    } finally {
      globalIsDownloading = false;
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    const skipDev = __DEV__ && !FORCE_OTA_IN_DEV;
    if (skipDev || !Updates || !UpdatesAvailable) {
      if (skipDev)
        console.log(
          "[Updates] Skip check: __DEV__ (set EXPO_PUBLIC_FORCE_OTA_CHECK=true to test)",
        );
      return;
    }

    if (globalIsChecking) return;
    globalIsChecking = true;

    const isEnabled = safeGet(() => {
      if (typeof Updates?.isEnabled === "undefined") return false;
      return Updates.isEnabled;
    }, false);

    if (!isEnabled) {
      console.log("[Updates] Skip check: expo-updates not enabled");
      globalIsChecking = false;
      return;
    }

    const channel = safeGet(() => Updates?.channel ?? null, null);
    const runtimeVersion = safeGet(() => Updates?.runtimeVersion ?? null, null);
    console.log(
      "[Updates] Checking — channel:",
      channel,
      "runtimeVersion:",
      runtimeVersion,
    );

    useOtaUpdateStore.getState().setChecking(true);
    useOtaUpdateStore.getState().setCheckError(null);

    try {
      const update = await safeGet(
        () => Updates!.checkForUpdateAsync(),
        Promise.resolve({ isAvailable: false } as Awaited<
          ReturnType<typeof Updates.checkForUpdateAsync>
        >),
      );

      console.log(
        "[Updates] Check result — isAvailable:",
        !!update?.isAvailable,
      );

      if (
        !update?.isAvailable &&
        Updates &&
        typeof Updates.readLogEntriesAsync === "function"
      ) {
        try {
          const entries = await Updates.readLogEntriesAsync(60_000);
          const last = entries.slice(-5);
          if (last.length)
            console.log(
              "[Updates] Native log entries (last 5):",
              JSON.stringify(last, null, 0),
            );
        } catch (e) {
          /* no-op */
        }
      }

      if (update && update.isAvailable) {
        useOtaUpdateStore.getState().setChecking(false);
        useOtaUpdateStore.getState().setUpdateAvailable(true);
        // Reset globalIsChecking BEFORE calling downloadAndApplyUpdate — otherwise
        // downloadAndApplyUpdate sees globalIsChecking=true and immediately bails.
        globalIsChecking = false;
        downloadAndApplyUpdate();
      } else {
        useOtaUpdateStore.getState().setChecking(false);
        useOtaUpdateStore.getState().setUpdateAvailable(false);
      }
    } catch (error) {
      console.warn("[Updates] Check failed (non-fatal):", error);
      useOtaUpdateStore.getState().setChecking(false);
      useOtaUpdateStore.getState().setCheckError(
        error instanceof Error
          ? error.message
          : "Failed to check for updates",
      );
    } finally {
      globalIsChecking = false;
    }
  }, [downloadAndApplyUpdate]);

  useEffect(() => {
    const skipDev = __DEV__ && !FORCE_OTA_IN_DEV;
    if (skipDev) {
      console.log(
        "[Updates] Skipping OTA init in __DEV__ (use production build or EXPO_PUBLIC_FORCE_OTA_CHECK=true)",
      );
      return;
    }

    if (!enabled) {
      console.log(
        "[Updates] OTA init deferred — waiting for splash to complete",
      );
      return;
    }

    if (!Updates || !UpdatesAvailable || globalIsInitialized) return;

    try {
      const isEnabled = safeGet(() => {
        if (typeof Updates?.isEnabled === "undefined") return false;
        return Updates.isEnabled;
      }, false);

      if (!isEnabled) {
        console.log("[Updates] OTA init skipped: expo-updates not enabled");
        return;
      }

      globalIsInitialized = true;
      const ch = safeGet(() => Updates?.channel ?? null, null);
      const rv = safeGet(() => Updates?.runtimeVersion ?? null, null);
      console.log(
        "[Updates] OTA init — channel:",
        ch,
        "runtimeVersion:",
        rv,
        "| Publish: eas update --channel",
        ch ?? "production",
      );

      let appStateSubscription: ReturnType<
        typeof AppState.addEventListener
      > | null = null;
      let updateEventSubscription: { remove: () => void } | null = null;

      const initialCheckTimer = setTimeout(() => {
        checkForUpdates().catch((e) =>
          console.error("[Updates] Initial check error:", e),
        );
      }, 1500);

      const retryTimer = setTimeout(() => {
        console.log("[Updates] Second OTA check (retry)");
        checkForUpdates().catch((e) =>
          console.error("[Updates] Retry check error:", e),
        );
      }, 15000);

      const handleAppStateChange = (nextState: AppStateStatus) => {
        if (nextState === "active") {
          console.log("[Updates] App came to foreground");
          try {
            checkForUpdates();
          } catch (error) {
            console.error(
              "[Updates] Foreground check error (non-fatal):",
              error,
            );
          }
        }
      };

      try {
        appStateSubscription = AppState.addEventListener(
          "change",
          handleAppStateChange,
        );
      } catch (error) {
        console.error(
          "[Updates] Failed to add app state listener (non-fatal):",
          error,
        );
      }

      try {
        const addListener =
          (Updates as any)?.addUpdatesStateChangeListener ||
          (Updates as any)?.addListener;
        if (Updates && typeof addListener === "function") {
          updateEventSubscription = addListener((event: any) => {
            try {
              console.log(
                "[Updates] Received update event:",
                event?.type || event?.context?.isUpdateAvailable,
              );

              const eventType = event?.type;
              const isUpdateAvailable = event?.context?.isUpdateAvailable;
              if (
                eventType === "UPDATE_AVAILABLE" ||
                eventType === "updateAvailable" ||
                isUpdateAvailable === true
              ) {
                console.log("[Updates] Update available event received");
                useOtaUpdateStore.getState().setUpdateAvailable(true);
                downloadAndApplyUpdate();
              }
            } catch (eventError) {
              console.error(
                "[Updates] Error handling event (non-fatal):",
                eventError,
              );
            }
          });
        }
      } catch (listenerError) {
        console.error(
          "[Updates] Failed to add update listener (non-fatal):",
          listenerError,
        );
      }

      return () => {
        try {
          clearTimeout(initialCheckTimer);
          if (retryTimer) clearTimeout(retryTimer);
          if (appStateSubscription) appStateSubscription.remove();
          if (updateEventSubscription) updateEventSubscription.remove();
        } catch (cleanupError) {
          console.error("[Updates] Cleanup error (non-fatal):", cleanupError);
        }
      };
    } catch (error) {
      console.error(
        "[Updates] Initialization error (non-fatal, app continues):",
        error,
      );
      globalIsInitialized = false;
    }
  }, [checkForUpdates, downloadAndApplyUpdate, enabled]);

  const currentlyRunning = safeGet(() => {
    if (!Updates || !UpdatesAvailable) return null;
    const isEnabled = safeGet(() => Updates?.isEnabled, false);
    if (!isEnabled) return null;

    return {
      updateId: safeGet(() => Updates?.updateId, null),
      channel: safeGet(() => Updates?.channel, null),
      createdAt: safeGet(() => Updates?.createdAt, null),
      isEmbeddedLaunch: safeGet(() => Updates?.isEmbeddedLaunch, null),
    };
  }, null);

  return {
    isChecking: store.isChecking,
    isDownloading: store.isDownloading,
    isUpdateAvailable: store.isUpdateAvailable,
    isUpdatePending: store.isUpdatePending,
    error: store.checkError,
    checkForUpdates,
    downloadAndApplyUpdate,
    currentlyRunning,
    reloadApp,
  };
}
