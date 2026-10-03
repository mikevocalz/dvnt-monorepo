"use client";

/**
 * "Hide event" and "Go public at" for the web create and edit forms (E06).
 *
 * The go-public time is when the listing appears, not the event's date. It is
 * typed as a wall clock and read in the event's zone, like Starts and Ends.
 * Hiding wins over the schedule: a hidden event stays hidden after that time.
 */

import { useId } from "react";
import { zoneDisplayName } from "@dvnt/app/lib/events/event-zone";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventPublicationFieldWeb({
  isHidden,
  onHiddenChange,
  publishAt,
  onPublishAtChange,
  eventTz,
  error,
}: {
  isHidden: boolean;
  onHiddenChange: (v: boolean) => void;
  /** Device-local ISO holding the typed wall clock, or "" for none. */
  publishAt: string;
  onPublishAtChange: (localIso: string) => void;
  eventTz: string;
  error?: string | null;
}) {
  const hideId = useId();
  const hintId = useId();
  const inputId = useId();

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={hideId} className="flex items-start justify-between gap-3 cursor-pointer">
        <span>
          <span className="block text-sm font-semibold text-white">Hide event</span>
          <span className="block text-[12px] text-white/55">
            Only you, co-hosts, invited guests and ticket holders can open it. It won&apos;t show
            in Home, For You or search.
          </span>
        </span>
        <input
          id={hideId}
          type="checkbox"
          role="switch"
          aria-checked={isHidden}
          checked={isHidden}
          onChange={(e) => onHiddenChange(e.target.checked)}
          className="mt-1 h-5 w-9 shrink-0 cursor-pointer appearance-none rounded-full bg-white/15 transition-colors checked:bg-[#8A40CF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white relative before:absolute before:top-0.5 before:left-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-4"
        />
      </label>

      <div className={isHidden ? "opacity-50" : undefined}>
        <label htmlFor={inputId} className="block text-sm font-semibold text-white">
          Go public at <span className="font-normal text-white/50">(optional)</span>
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <input
            id={inputId}
            type="datetime-local"
            value={publishAt ? toLocalInput(publishAt) : ""}
            onChange={(e) => {
              const d = e.target.value ? new Date(e.target.value) : null;
              onPublishAtChange(d && !Number.isNaN(d.getTime()) ? d.toISOString() : "");
            }}
            disabled={isHidden}
            aria-invalid={error ? true : undefined}
            aria-describedby={hintId}
            className={`h-10 flex-1 rounded-xl bg-white/8 px-3 text-sm text-white outline-none disabled:cursor-not-allowed ${error ? "ring-1 ring-red-500" : ""}`}
          />
          {publishAt ? (
            <button
              type="button"
              onClick={() => onPublishAtChange("")}
              className="h-10 rounded-xl px-3 text-[13px] font-semibold text-[#C084FC]"
            >
              Clear
            </button>
          ) : null}
        </div>
        <p id={hintId} role={error ? "alert" : undefined} className={`mt-1 text-[12px] ${error ? "text-red-400" : "text-white/50"}`}>
          {error ??
            (isHidden
              ? "Turn off Hide event to schedule when it goes public."
              : `Leave blank to list it as soon as you publish. Read in ${zoneDisplayName(eventTz)}.`)}
        </p>
      </div>
    </div>
  );
}
