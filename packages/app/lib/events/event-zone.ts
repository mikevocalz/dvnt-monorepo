/**
 * Event time zones: the zone an organizer picks, and the conversion between
 * the wall-clock time they type and the UTC instant we store.
 *
 * Both create forms keep the picked date/time as a device-local Date (that is
 * what DateTimePicker and <input type="datetime-local"> hand back). Its
 * year/month/day/hour/minute fields are the wall clock the organizer meant.
 * Before anything is stored, those fields are re-read in the event's zone, so
 * "8:00 PM" typed on a phone in New York for a Los Angeles venue is stored as
 * 8:00 PM Pacific, not 8:00 PM Eastern.
 *
 * Intl only, no date library: Hermes and every browser we ship support
 * Intl.DateTimeFormat with an IANA timeZone and formatToParts.
 */

import { IANA_TIME_ZONES } from "./iana-zones.ts";

export interface WallClock {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
}

/** One-tap choices shown above the search. */
export const QUICK_ZONES: readonly { id: string; label: string }[] = [
  { id: "America/New_York", label: "Eastern" },
  { id: "America/Chicago", label: "Central" },
  { id: "America/Denver", label: "Mountain" },
  { id: "America/Los_Angeles", label: "Pacific" },
  // London follows GMT in winter and BST in summer. Pick UTC for a fixed
  // offset that never shifts.
  { id: "Europe/London", label: "London (GMT/BST)" },
  { id: "UTC", label: "UTC" },
];

const validCache = new Map<string, boolean>();

/** True for a zone name Intl accepts (IANA region/city, or UTC). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  const cached = validCache.get(tz);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  validCache.set(tz, ok);
  return ok;
}

/** The zone name, or null when it is missing or not a real zone. */
export function normalizeTimeZone(tz: unknown): string | null {
  return isValidTimeZone(tz) ? tz.trim() : null;
}

/** The device's IANA zone, or UTC when the runtime cannot say. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return normalizeTimeZone(tz) ?? "UTC";
  } catch {
    return "UTC";
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** The wall clock an instant reads in `tz`. */
export function wallClockInZone(
  instant: Date | number | string,
  tz: string,
): WallClock {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = partsFormatter(tz).formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some engines print midnight as hour 24 under hour12:false.
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** Milliseconds `tz` is ahead of UTC at `instantMs`. */
function zoneOffsetMs(instantMs: number, tz: string): number {
  const wc = wallClockInZone(instantMs, tz);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute);
  // Seconds are dropped above, so compare against the minute-floored instant.
  return asUtc - Math.floor(instantMs / 60_000) * 60_000;
}

/**
 * The instant at which `tz` reads `wc`.
 *
 * DST: on a spring-forward night a skipped wall time (2:30 AM) resolves
 * forward by the gap (3:30 AM). On a fall-back night a repeated wall time
 * (1:30 AM) resolves to its first occurrence, the daylight one.
 */
export function zonedWallClockToInstant(wc: WallClock, tz: string): Date {
  const guess = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute);
  const before = zoneOffsetMs(guess - 864e5 / 2, tz);
  const after = zoneOffsetMs(guess + 864e5 / 2, tz);
  // Try both offsets seen around this date; keep the candidate that reads
  // back as the requested wall clock. Earliest wins (fall-back: first 1:30).
  const candidates = [guess - before, guess - after].sort((a, b) => a - b);
  for (const t of candidates) {
    const back = wallClockInZone(t, tz);
    if (
      back.year === wc.year &&
      back.month === wc.month &&
      back.day === wc.day &&
      back.hour === wc.hour &&
      back.minute === wc.minute
    ) {
      return new Date(t);
    }
  }
  // No candidate matched: the wall time does not exist (spring-forward gap).
  // Apply the pre-transition offset, which lands past the gap.
  return new Date(guess - before);
}

/** Device-local fields of a Date: what a native/browser picker shows. */
export function wallClockOfLocalDate(d: Date): WallClock {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
  };
}

/** A device-local Date whose fields read `wc`, for feeding pickers. */
export function localDateFromWallClock(wc: WallClock): Date {
  return new Date(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, 0, 0);
}

/**
 * Picker value -> stored instant. `localIso` is a device-local Date's ISO
 * string (what the create store holds); its wall clock is read in `tz`.
 * Returns "" for an unparseable input.
 */
export function localIsoToZonedIso(localIso: string, tz: string): string {
  const d = new Date(localIso);
  if (Number.isNaN(d.getTime())) return "";
  const zone = normalizeTimeZone(tz) ?? deviceTimeZone();
  return zonedWallClockToInstant(wallClockOfLocalDate(d), zone).toISOString();
}

/**
 * Stored instant -> picker value: a device-local ISO whose wall clock is what
 * `tz` reads at that instant. Inverse of localIsoToZonedIso. Returns "" for an
 * unparseable input.
 */
export function zonedIsoToLocalIso(instantIso: string, tz: string): string {
  const d = new Date(instantIso);
  if (Number.isNaN(d.getTime())) return "";
  const zone = normalizeTimeZone(tz) ?? deviceTimeZone();
  return localDateFromWallClock(wallClockInZone(d, zone)).toISOString();
}

/** Short zone name at an instant: "PDT", "EST", "GMT+1". "" when unknown. */
export function zoneAbbreviation(
  instant: Date | number | string,
  tz: string,
): string {
  if (!isValidTimeZone(tz)) return "";
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return "";
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/** "Pacific (PDT)", "Asia/Tokyo (GMT+9)": how the picker names a zone. */
export function zoneDisplayName(tz: string, at: Date | number = Date.now()): string {
  const quick = QUICK_ZONES.find((z) => z.id === tz);
  const name = quick ? quick.label : tz.replace(/_/g, " ");
  const abbr = zoneAbbreviation(at, tz);
  return abbr && abbr !== name ? `${name} (${abbr})` : name;
}

/** Every zone the picker offers. */
export function allTimeZones(): readonly string[] {
  return IANA_TIME_ZONES;
}

/**
 * Zones matching a query, matched against the IANA name (with spaces for
 * underscores) and the current abbreviation. "los angeles", "tokyo", "pst".
 */
export function searchTimeZones(
  query: string,
  limit = 50,
  at: Date | number = Date.now(),
): string[] {
  const q = query.trim().toLowerCase().replace(/_/g, " ");
  if (!q) return IANA_TIME_ZONES.slice(0, limit);
  const out: string[] = [];
  for (const tz of IANA_TIME_ZONES) {
    const name = tz.toLowerCase().replace(/_/g, " ");
    const quick = QUICK_ZONES.find((z) => z.id === tz)?.label.toLowerCase() ?? "";
    if (
      name.includes(q) ||
      quick.includes(q) ||
      zoneAbbreviation(at, tz).toLowerCase() === q
    ) {
      out.push(tz);
      if (out.length >= limit) break;
    }
  }
  return out;
}
