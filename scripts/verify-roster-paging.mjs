#!/usr/bin/env node
/**
 * Host & Guest WS-2 — keyset pagination correctness.
 *
 * The roster's accept criterion is "a 5,000-row roster sorts by tier and pages
 * without duplicates or gaps". That property is pure logic about the cursor
 * predicate, so it is proved here rather than against the database — which
 * means it runs in CI, needs no seed data, and cannot be broken silently.
 *
 * The predicate mirrored below is the one `get-event-tickets` sends to
 * PostgREST verbatim:
 *
 *   or(<col>.<op>.<value>, and(<col>.eq.<value>, id.<op>.<cursorId>))
 *
 * The interesting case is TIES. Real rosters have them in bulk — a batch of
 * tickets issued by one cart share a created_at to the millisecond. A keyset
 * on `created_at` alone silently drops or repeats every tied row at a page
 * boundary; that is why `id` is in the tuple, and this file is what stops
 * someone "simplifying" it back out.
 *
 *   node scripts/verify-roster-paging.mjs
 */
import assert from "node:assert";

const PAGE = 100;
const TOTAL = 5000;
/**
 * Rows per tie group, deliberately COPRIME with PAGE. An earlier version of
 * this file used 10-row groups against a 100-row page: every boundary landed
 * neatly between groups, so a tie never straddled a page edge and the test
 * passed even with the id tie-break deleted. 7 does not divide 100, so
 * boundaries land mid-group and the tie case is actually exercised.
 */
const TIE_GROUP = 7;

/** The synthetic roster, in no particular order (the DB's is arbitrary too). */
function makeRows() {
  const rows = [];
  for (let i = 1; i <= TOTAL; i++) {
    rows.push({ id: String(i).padStart(6, "0"), ts: Math.floor(i / TIE_GROUP) });
  }
  // Shuffle deterministically so we never accidentally depend on insert order.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = (i * 7919) % (i + 1);
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}

/** Total order on (ts, id) in the sort's direction — what the DB's ORDER BY does. */
function comparator(asc) {
  const dir = asc ? 1 : -1;
  return (a, b) =>
    a.ts !== b.ts ? (a.ts - b.ts) * dir : a.id < b.id ? -dir : a.id > b.id ? dir : 0;
}

/** The cursor predicate, exactly as the edge function composes it. */
function afterCursor(row, cursor, asc) {
  if (!cursor) return true;
  const strictly = asc
    ? row.ts > cursor.ts
    : row.ts < cursor.ts;
  const tieBreak =
    row.ts === cursor.ts && (asc ? row.id > cursor.id : row.id < cursor.id);
  return strictly || tieBreak;
}

function pageThrough(rows, asc) {
  const cmp = comparator(asc);
  const seen = [];
  let cursor = null;
  let guard = 0;

  for (;;) {
    if (++guard > TOTAL) throw new Error("paging did not terminate");
    const page = rows
      .filter((r) => afterCursor(r, cursor, asc))
      .sort(cmp)
      .slice(0, PAGE);
    if (page.length === 0) break;
    seen.push(...page);
    const last = page[page.length - 1];
    cursor = { ts: last.ts, id: last.id };
    if (page.length < PAGE) break;
  }
  return seen;
}

for (const asc of [false, true]) {
  const rows = makeRows();
  const seen = pageThrough(rows, asc);
  const label = asc ? "ascending" : "descending";

  // No duplicates — the failure mode of a naive keyset at a tie boundary.
  const ids = seen.map((r) => r.id);
  assert.strictEqual(
    new Set(ids).size,
    ids.length,
    `${label}: a row was served on two pages`,
  );

  // No gaps — every row surfaced exactly once.
  assert.strictEqual(
    ids.length,
    TOTAL,
    `${label}: paged ${ids.length} of ${TOTAL} rows — rows were skipped`,
  );

  // And the concatenation is in the same order a single unpaginated scan gives.
  const oneShot = [...rows].sort(comparator(asc)).map((r) => r.id);
  assert.deepStrictEqual(
    ids,
    oneShot,
    `${label}: paged order diverges from a single ordered scan`,
  );
}

/**
 * Rows inserted mid-scroll must not shift the window. Offset paging fails this
 * outright — that is the whole reason the function moved off `.range()`.
 */
{
  const rows = makeRows();
  const cmp = comparator(false);
  const firstPage = [...rows].sort(cmp).slice(0, PAGE);
  const cursor = {
    ts: firstPage[PAGE - 1].ts,
    id: firstPage[PAGE - 1].id,
  };

  // A brand-new ticket sorts to the very top (newest ts) — ahead of the cursor.
  rows.push({ id: "999999", ts: Math.ceil(TOTAL / TIE_GROUP) + 1 });

  const secondPage = rows
    .filter((r) => afterCursor(r, cursor, false))
    .sort(cmp)
    .slice(0, PAGE);

  const firstIds = new Set(firstPage.map((r) => r.id));
  assert.ok(
    !secondPage.some((r) => firstIds.has(r.id)),
    "an insert mid-scroll pushed an already-seen row onto page 2",
  );
  assert.ok(
    !secondPage.some((r) => r.id === "999999"),
    "a row inserted ahead of the cursor leaked into a later page",
  );
}

console.log(
  `roster keyset paging OK — ${TOTAL} rows in ${TIE_GROUP}-row tie groups, ` +
    `both directions, stable under mid-scroll insert`,
);
