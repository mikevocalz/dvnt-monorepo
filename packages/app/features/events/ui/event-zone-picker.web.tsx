"use client";

/**
 * Time zone field for the web create and edit forms.
 *
 * Six one-tap zones cover most DVNT events; the search reaches every IANA
 * zone. The picked zone decides how the Starts/Ends inputs are read, so the
 * caption under the field names it in plain words.
 */

import { useId, useMemo, useState } from "react";
import {
  QUICK_ZONES,
  searchTimeZones,
  zoneDisplayName,
} from "@dvnt/app/lib/events/event-zone";

export function EventZonePickerWeb({
  value,
  onChange,
  at,
}: {
  value: string;
  onChange: (tz: string) => void;
  /** Instant used for the abbreviation (the event start), so PDT vs PST is right. */
  at?: string | null;
}) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const labelId = useId();
  const when = at && !Number.isNaN(Date.parse(at)) ? Date.parse(at) : Date.now();

  const results = useMemo(
    () => (query.trim() ? searchTimeZones(query, 8, when) : []),
    [query, when],
  );
  const chips = QUICK_ZONES.some((z) => z.id === value)
    ? QUICK_ZONES
    : [{ id: value, label: value.replace(/_/g, " ") }, ...QUICK_ZONES];

  const pick = (tz: string) => {
    onChange(tz);
    setQuery("");
  };

  return (
    <div className="flex flex-col gap-2" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="text-xs text-white/55">
        Time zone
      </span>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((z) => {
          const on = z.id === value;
          return (
            <button
              key={z.id}
              type="button"
              aria-pressed={on}
              onClick={() => pick(z.id)}
              className={`h-8 rounded-full px-3 text-[13px] font-semibold border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF] ${
                on
                  ? "bg-[#3FDCFF] text-[#02030A] border-[#3FDCFF]"
                  : "bg-white/[0.05] text-white/80 border-white/12 hover:border-white/30"
              }`}
            >
              {z.label}
            </button>
          );
        })}
      </div>
      <div className="relative">
        <input
          type="search"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-label="Search all time zones"
          placeholder="Search any city or zone"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              e.preventDefault();
              pick(results[0]);
            }
            if (e.key === "Escape") setQuery("");
          }}
          className="w-full bg-white/[0.05] border border-white/12 rounded-xl px-3 h-10 text-[14px] text-white placeholder:text-white/40 outline-none focus:border-[#3FDCFF]/60"
        />
        {results.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-white/12 bg-[#0B0E1A] py-1 shadow-lg"
          >
            {results.map((tz) => (
              <li key={tz} role="option" aria-selected={tz === value}>
                <button
                  type="button"
                  onClick={() => pick(tz)}
                  className="w-full text-left px-3 py-2 text-[14px] text-white/85 hover:bg-white/[0.06] focus-visible:bg-white/[0.08] outline-none"
                >
                  {zoneDisplayName(tz, when)}
                </button>
              </li>
            ))}
          </ul>
        ) : query.trim() ? (
          <p className="text-xs text-white/45 mt-1">No zone matches “{query.trim()}”.</p>
        ) : null}
      </div>
      <p className="text-xs text-white/55">
        Start and end times are in {zoneDisplayName(value, when)}.
      </p>
    </div>
  );
}
