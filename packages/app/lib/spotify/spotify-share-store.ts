import { create } from "zustand";
import {
  parseSpotifyLink,
  fetchSpotifyOEmbed,
  extractSpotifyUrl,
  isSpotifyUrl,
  type SpotifyLink,
  type SpotifyOEmbed,
} from "./parse-spotify-link";

interface SpotifyShareState {
  pendingLink: SpotifyLink | null;
  oEmbed: SpotifyOEmbed | null;
  isLoading: boolean;
  sheetVisible: boolean;
  rawText: string | null;

  processSharedText: (text: string) => Promise<void>;
  showSheet: () => void;
  hideSheet: () => void;
  clear: () => void;
}

export const useSpotifyShareStore = create<SpotifyShareState>((set, get) => ({
  pendingLink: null,
  oEmbed: null,
  isLoading: false,
  sheetVisible: false,
  rawText: null,

  processSharedText: async (text: string) => {
    const url = extractSpotifyUrl(text);
    if (!url || !isSpotifyUrl(url)) return;

    const parsed = parseSpotifyLink(url);
    if (!parsed) return;

    set({ pendingLink: parsed, rawText: text, isLoading: true, sheetVisible: true });

    const oEmbed = await fetchSpotifyOEmbed(parsed.url);
    set({ oEmbed, isLoading: false });
  },

  showSheet: () => set({ sheetVisible: true }),
  hideSheet: () => set({ sheetVisible: false }),
  clear: () =>
    set({
      pendingLink: null,
      oEmbed: null,
      isLoading: false,
      sheetVisible: false,
      rawText: null,
    }),
}));
