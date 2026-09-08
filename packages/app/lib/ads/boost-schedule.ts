/**
 * When a boost starts and ends, in the event's own timezone.
 *
 * `promotion-checkout/index.ts:42-55` computes this with `getDay()`,
 * `setDate()` and `setHours()` — all local-time methods, in a Deno runtime
 * whose local zone is UTC. Two bugs follow, and the second is the expensive one:
 *
 * 1. "Sunday 23:59:59.999" is UTC, so a New York organizer's weekend boost ends
 *    19:59 EDT — four hours early, on Sunday evening.
 * 2. `daysUntilSunday = (7 - day) % 7 || 7` reads the UTC day of week. A
 *    campaign bought Saturday 9pm EDT is Sunday 01:00 UTC, so `day === 0`, so
 *    the expression falls through to `7` and the boost ends the FOLLOWING
 *    Sunday — roughly eight days of delivery sold as a weekend.
 *
 * Everything here works in the event's IANA zone via `Intl`, with no
 * dependency, so the same function can run in Deno and in the app.
 */

export type BoostDuration = "24h" | "7d" | "weekend";

/** Hours for the fixed-length packages. Matches DURATION_HOURS on the server. */
const DURATION_HOURS: Record<Exclude<BoostDuration, "weekend">, number> = {
  "24h": 24,
  "7d": 168,
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock parts of an instant, as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `hour12: false` renders midnight as 24 in some ICU versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/** The zone's offset from UTC at `instant`, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Rounded because `asUtc` is built from second-precision parts while
  // `instant` carries milliseconds — without this the .999 of an end-of-day
  // instant leaked into the offset and pushed the result a second into the
  // next day, turning "Sunday 23:59:59.999" into Monday. Zone offsets are
  // always a whole number of minutes, so rounding loses nothing.
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * The instant at which a given wall-clock time occurs in `timeZone`.
 *
 * Resolved twice because the offset itself depends on the instant — across a
 * DST boundary the first guess uses the wrong offset.
 */
export function instantFromZoned(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number; ms?: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms ?? 0,
  );
  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/**
 * When a boost of this duration, bought at `start`, should end.
 *
 * `weekend` means "through the end of the coming Sunday, where the event is" —
 * and a boost bought ON a Sunday ends that same night, not eight days later.
 */
export function computeBoostEnd(
  start: Date,
  duration: BoostDuration,
  timeZone: string,
): Date {
  if (duration !== "weekend") {
    return new Date(start.getTime() + DURATION_HOURS[duration] * 3_600_000);
  }

  const p = zonedParts(start, timeZone);
  // Days until the coming Sunday, IN THE EVENT'S ZONE. Buying on a Sunday
  // gives 0 — that evening — rather than falling through to a whole extra week.
  const daysUntilSunday = (7 - p.weekday) % 7;

  return instantFromZoned(
    {
      year: p.year,
      month: p.month,
      day: p.day + daysUntilSunday,
      hour: 23,
      minute: 59,
      second: 59,
      ms: 999,
    },
    timeZone,
  );
}

/** How long the member is actually buying, for the review screen. */
export function boostDurationHours(
  start: Date,
  duration: BoostDuration,
  timeZone: string,
): number {
  const end = computeBoostEnd(start, duration, timeZone);
  return (end.getTime() - start.getTime()) / 3_600_000;
}

/**
 * The exact dates to show before payment, in the event's zone with the zone
 * named. "Ends Sunday" without a timezone is what let a four-hour shortfall go
 * unnoticed.
 */
export function describeBoostWindow(
  start: Date,
  duration: BoostDuration,
  timeZone: string,
): { startLabel: string; endLabel: string; timeZone: string } {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);

  const end = computeBoostEnd(start, duration, timeZone);
  // A weekend ends at 23:59:59.999, and a minute-precision formatter ROUNDS
  // that up — so the honest instant printed as "Mon 12:00 AM" and told an
  // organizer their weekend boost ran into Monday. The label names the last
  // minute the boost is live; the instant itself is unchanged.
  const endLabelInstant = new Date(end.getTime() - 1_000);

  return {
    startLabel: fmt(start),
    endLabel: fmt(endLabelInstant),
    timeZone,
  };
}
