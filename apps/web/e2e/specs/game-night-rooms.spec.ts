/**
 * Game Night rooms list — the render pass the discovery surface had never had.
 *
 * The list shipped unseen: seats, the GSAP stagger and the card partition were
 * argued for in review and never once opened in a browser. This spec is that
 * missing check. It asserts the merged Spill-style discovery layout:
 * "Find a Game" handle search, a "Games to Watch" rail for playing rooms,
 * and a "Games to Join" grid for open tables.
 *
 * It runs in the AUTHED lane: `/game-night` sits behind `WebAppShell`'s default
 * auth gate, because the rooms RPC reads through the bridged JWT and a
 * logged-out visitor would be told the connection failed when the real problem
 * is that they are not signed in.
 *
 * The RPC is stubbed rather than seeded. `game_night_list_rooms` is covered by
 * seats.test.ts and by the migration's own policy tests; what has never been
 * exercised is the component that draws its rows. Stubbing pins the fixture so
 * a screenshot means the same thing next month as it does today — seeding a
 * live lobby would make this spec fail whenever someone else starts a table.
 */

import { test, expect, type Page } from "@playwright/test";

const RPC = "**/rest/v1/rpc/game_night_list_rooms";

const player = (n: number) => ({
  id: `u${n}`,
  name: ["Ash", "Bex", "Cyd", "Dre", "Eli"][n % 5],
  avatar: null,
});

/**
 * Rows across both partitions: `open` rooms with seats left land in
 * "Games to Join", `playing` rooms land in "Games to Watch" — including a
 * full table, which stays watchable rather than disabled.
 */
const room = (
  i: number,
  seated: number,
  status: "open" | "playing" = "open",
  watchers = 0,
) => ({
  room_code: `TBL${String(i).padStart(3, "0")}`,
  status,
  host_name: player(i).name,
  host_avatar: null,
  player_count: seated,
  watcher_count: watchers,
  started_at: new Date().toISOString(),
  seat_avatars: Array.from({ length: seated }, (_, s) => player(i + s)),
});

async function stubRooms(page: Page, rows: unknown[]) {
  await page.route(RPC, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    }),
  );
}

/**
 * Navigate and wait for the screen to actually mount.
 *
 * `/game-night` renders through `next/dynamic` with `ssr: false`, so the HTML
 * arrives before the code that fills it does. In dev that chunk is compiled on
 * demand and routinely takes longer than the config's 5s assertion budget —
 * failures there read as "the list is broken" when the list has not loaded
 * yet. This waits on the heading every state shares, so the assertions
 * that follow are about the screen rather than about webpack.
 */
async function gotoLobby(page: Page) {
  await page.goto("/game-night");
  await expect(page.getByRole("heading", { name: "Find a Game" })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("game night rooms list", () => {
  // The suite default is 30s, which the first cold load here cannot make. The
  // budget is spent compiling, not rendering — once the chunk exists every
  // navigation settles in ~3s.
  test.describe.configure({ timeout: 150_000 });

  // Compile the route's chunk once, before any test navigates. Without this
  // every hard navigation races the dev compiler and the first one or two
  // tests fail on a page that is still showing "Compiling" — a flake that
  // says nothing about the list.
  // `baseURL` is taken from the fixture: `browser.newContext()` does NOT
  // inherit the project's `use.baseURL`, so a relative goto here would fail.
  test.beforeAll(async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.route(RPC, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
    );
    await page.goto("/game-night");
    await expect(page.getByRole("heading", { name: "Find a Game" })).toBeVisible({
      timeout: 120_000,
    });
    await context.close();
  });

  test("empty lobby draws four seats and the staggered invitation", async ({
    page,
  }) => {
    await stubRooms(page, []);
    await gotoLobby(page);

    await expect(page.getByRole("heading", { name: "No games are live" })).toBeVisible();
    // The stagger animates opacity from 0. If GSAP never ran, or ran and never
    // completed, the seats stay invisible — which is exactly the failure a
    // screenshot-only check would sail past.
    const seats = page.locator("[data-seat]");
    await expect(seats).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(seats.nth(i)).toBeVisible();
      await expect(seats.nth(i)).toHaveCSS("opacity", "1");
    }

    // One primary action on the screen, in the header.
    await expect(page.getByRole("button", { name: "Start a game" })).toHaveCount(1);
    await expect(page.getByText("Start the first table.")).toBeVisible();

    await page.screenshot({ path: "e2e/results/game-night-empty.png", fullPage: true });
  });

  test("open tables offer seats, live games offer watching", async ({ page }) => {
    await stubRooms(page, [
      room(1, 2, "open", 0),
      room(2, 4, "playing", 7),
      room(3, 3, "open", 0),
    ]);
    await gotoLobby(page);

    await expect(page.getByRole("heading", { name: "Games to Watch" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Games to Join" })).toBeVisible();

    // Two seated, two open — and the empty seats are DRAWN, not omitted.
    const partial = page.locator('a[href="/game-night/room/TBL001"]');
    await expect(partial.getByRole("list")).toHaveAttribute(
      "aria-label",
      "2 of 4 seats taken",
    );
    await expect(partial.getByRole("listitem")).toHaveCount(4);
    await expect(partial.getByText("2 open")).toBeVisible();
    await expect(partial).toHaveAttribute("aria-label", /Join Bex game/);

    // A live table is never disabled; it is a different offer.
    const full = page.locator('a[href="/game-night/room/TBL002"]');
    await expect(full).toHaveAttribute("aria-label", /Watch Cyd game/);
    await expect(full.getByText("7")).toBeVisible();
    await expect(full).toBeEnabled();

    // Singular seat math is a real branch in seatsLeft's consumer.
    await expect(
      page.locator('a[href="/game-night/room/TBL003"]').getByText("1 open"),
    ).toBeVisible();

    await page.screenshot({ path: "e2e/results/game-night-rooms.png", fullPage: true });
  });

  test("handle search filters both sections", async ({ page }) => {
    await stubRooms(page, [
      room(1, 2, "open", 0), // Ash
      room(2, 4, "playing", 7), // Bex
      room(3, 3, "open", 0), // Cyd
    ]);
    await gotoLobby(page);

    await expect(page.locator('a[href="/game-night/room/TBL001"]')).toBeVisible();

    // "bex" matches only TBL001's host; the seat lists rotate player(i+s), so
    // every other name on the table also appears in another room's seats.
    // A host-only needle is the one search that isolates a single room.
    await page.getByPlaceholder("Search by handle").fill("bex");
    await expect(page.locator('a[href="/game-night/room/TBL001"]')).toBeVisible();
    await expect(page.locator('a[href="/game-night/room/TBL002"]')).toHaveCount(0);
    await expect(page.locator('a[href="/game-night/room/TBL003"]')).toHaveCount(0);

    // A needle that matches nothing says so, instead of rendering empty rails.
    await page.getByPlaceholder("Search by handle").fill("zzzzz");
    await expect(page.getByText("No handles match")).toBeVisible();
  });

  test("a failed read says connection, not empty lobby", async ({ page }) => {
    await page.route(RPC, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    await gotoLobby(page);

    await expect(page.getByText("Could not load the games")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No games are live" })).toHaveCount(0);
  });
});
