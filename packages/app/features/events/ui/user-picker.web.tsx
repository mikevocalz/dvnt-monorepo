"use client";

/**
 * UserPicker — search + select a DVNT user (web, staff/promoter adds).
 *
 * Presentational + fetching only: the parent store owns the query string
 * and the selection, so the component stays controlled and the calling
 * dialog decides what "picked" means. Debounces `searchApi.searchUsers`
 * (300ms) — typing never fires a query per keystroke.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { searchApi } from "@dvnt/app/lib/api/search";

export interface PickedUser {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

export function UserPicker({
  query,
  onQueryChange,
  selected,
  onSelect,
  onClear,
  placeholder = "Search people…",
  disabled = false,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  selected: PickedUser | null;
  onSelect: (u: PickedUser) => void;
  onClear: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [debounced, setDebounced] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(query.trim()), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  const results = useQuery({
    queryKey: ["user-picker", debounced],
    queryFn: () => searchApi.searchUsers(debounced, 8),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  });

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/6 px-3 py-2.5">
        <PickerAvatar user={selected} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white">
            {selected.name}
          </p>
          <p className="truncate text-[13px] text-white/45">
            @{selected.username}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label={`Clear ${selected.name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 active:bg-white/10 disabled:opacity-40"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const docs = results.data?.docs ?? [];
  return (
    <div>
      <div className="flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
        <Search size={16} color="rgba(255,255,255,0.4)" aria-hidden />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          disabled={disabled}
          className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/35 outline-none disabled:opacity-50"
        />
        {results.isFetching ? (
          <Loader2 size={14} className="animate-spin text-white/40" />
        ) : null}
      </div>

      {debounced.length >= 2 ? (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/8 bg-white/[0.03]">
          {results.isSuccess && docs.length === 0 ? (
            <li className="px-4 py-3 text-sm text-white/45">
              Nobody matches &ldquo;{debounced}&rdquo;.
            </li>
          ) : (
            docs.map((u: any) => {
              const user: PickedUser = {
                id: String(u.id),
                username: u.username || "unknown",
                name: u.name || u.username || "Unknown",
                avatar: u.avatar || "",
              };
              return (
                <li key={user.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(user)}
                    disabled={disabled}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-white/6 disabled:opacity-50"
                  >
                    <PickerAvatar user={user} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-white">
                        {user.name}
                      </span>
                      <span className="block truncate text-[13px] text-white/45">
                        @{user.username}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-white/35">
          Type a name or @username to search DVNT members.
        </p>
      )}
    </div>
  );
}

function PickerAvatar({ user }: { user: PickedUser }) {
  // Rounded square, never a circle — same rule as the staff roster.
  return user.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={user.avatar}
      alt=""
      className="h-9 w-9 shrink-0 rounded-xl object-cover"
    />
  ) : (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[15px] font-semibold text-white"
      aria-hidden
    >
      {(user.name || user.username || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}
