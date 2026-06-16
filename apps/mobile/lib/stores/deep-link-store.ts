/**
 * Deep Link Store
 * Manages pending deep links during auth bootstrap, replay protection,
 * and navigation state for the deep linking system.
 */

import { create } from "zustand";

export interface ParsedDeepLink {
  /** Original URL string */
  originalUrl: string;
  /** Normalized path (no scheme, no domain, no trailing slash) */
  path: string;
  /** Query params as Record */
  params: Record<string, string>;
  /** Expo Router destination path */
  routerPath: string;
  /** Whether this route requires auth */
  requiresAuth: boolean;
  /** Timestamp when parsed */
  timestamp: number;
}

interface DeepLinkState {
  /** Link waiting for auth to complete before navigation */
  pendingLink: ParsedDeepLink | null;
  /** Last handled URL + timestamp for replay protection */
  lastHandledUrl: string | null;
  lastHandledAt: number;
  /** Whether auth bootstrap is complete */
  authBootstrapComplete: boolean;
  /** App opened from share intent (dvnt://dataUrl=...); mount ShareIntentHandler immediately */
  openedFromShareIntent: boolean;

  // Actions
  setOpenedFromShareIntent: (v: boolean) => void;
  setPendingLink: (link: ParsedDeepLink | null) => void;
  consumePendingLink: () => ParsedDeepLink | null;
  markHandled: (url: string) => void;
  isReplay: (url: string) => boolean;
  setAuthBootstrapComplete: (complete: boolean) => void;
}

const REPLAY_WINDOW_MS = 3000; // 3 seconds

export const useDeepLinkStore = create<DeepLinkState>((set, get) => ({
  pendingLink: null,
  lastHandledUrl: null,
  lastHandledAt: 0,
  authBootstrapComplete: false,
  openedFromShareIntent: false,

  setOpenedFromShareIntent: (v) => set({ openedFromShareIntent: v }),

  setPendingLink: (link) => {
    console.log("[DeepLink] setPendingLink:", link?.path || "null");
    set({ pendingLink: link });
  },

  consumePendingLink: () => {
    const { pendingLink } = get();
    if (pendingLink) {
      console.log("[DeepLink] consumePendingLink:", pendingLink.path);
      set({ pendingLink: null });
    }
    return pendingLink;
  },

  markHandled: (url) => {
    set({ lastHandledUrl: url, lastHandledAt: Date.now() });
  },

  isReplay: (url) => {
    const { lastHandledUrl, lastHandledAt } = get();
    if (lastHandledUrl !== url) return false;
    return Date.now() - lastHandledAt < REPLAY_WINDOW_MS;
  },

  setAuthBootstrapComplete: (complete) => {
    console.log("[DeepLink] authBootstrapComplete:", complete);
    set({ authBootstrapComplete: complete });
  },
}));
