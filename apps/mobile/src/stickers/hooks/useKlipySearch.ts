/**
 * useKlipySearch — TanStack Query + @tanstack/pacer debounce
 *
 * Tab-aware query keys, automatic cancellation, autocomplete.
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Debouncer } from "@tanstack/pacer";
import {
  klipySearch,
  klipyAutocomplete,
  type KlipyTab,
  type KlipySearchResponse,
} from "@/src/stickers/api/klipy";
import { useStickerStore } from "@/src/stickers/stores/sticker-store";

const DEBOUNCE_MS = 350;

// ── Debounced search value ─────────────────────────────

export function useDebouncedValue(value: string, ms = DEBOUNCE_MS): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const debouncer = new Debouncer(
      (v: string) => setDebounced(v),
      { wait: ms },
    );
    debouncer.maybeExecute(value);
    return () => debouncer.cancel();
  }, [value, ms]);

  return debounced;
}

// ── Query keys ─────────────────────────────────────────

export const klipyKeys = {
  all: ["klipy"] as const,
  search: (tab: KlipyTab, query: string) =>
    ["klipy", "search", tab, query] as const,
  trending: (tab: KlipyTab) =>
    ["klipy", "trending", tab] as const,
  autocomplete: (query: string) =>
    ["klipy", "autocomplete", query] as const,
};

// ── Main search hook ───────────────────────────────────

export function useKlipySearch() {
  const activeTab = useStickerStore((s) => s.activeTab);
  const searchInput = useStickerStore((s) => s.searchInput);
  const debouncedQuery = useDebouncedValue(searchInput);

  const isTrending = !debouncedQuery.trim();
  const queryKey = isTrending
    ? klipyKeys.trending(activeTab)
    : klipyKeys.search(activeTab, debouncedQuery);

  const searchQuery = useQuery<KlipySearchResponse>({
    queryKey,
    queryFn: ({ signal }) =>
      klipySearch(activeTab, debouncedQuery, { signal }),
    staleTime: 1000 * 60 * 5, // 5 min
    gcTime: 1000 * 60 * 10,
    placeholderData: (prev) => prev,
  });

  return {
    ...searchQuery,
    items: searchQuery.data?.results ?? [],
    isTrending,
    activeTab,
    debouncedQuery,
  };
}

// ── Autocomplete hook ──────────────────────────────────

export function useKlipyAutocomplete() {
  const searchInput = useStickerStore((s) => s.searchInput);
  const debouncedQuery = useDebouncedValue(searchInput, 250);

  const autocompleteQuery = useQuery<string[]>({
    queryKey: klipyKeys.autocomplete(debouncedQuery),
    queryFn: ({ signal }) => klipyAutocomplete(debouncedQuery, signal),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  return {
    suggestions: autocompleteQuery.data ?? [],
    isLoading: autocompleteQuery.isLoading,
  };
}
