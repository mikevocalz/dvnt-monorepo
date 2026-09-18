/**
 * Game Night rooms list — the render pass the list had never had.
 *
 * The list shipped unseen: seats, the GSAP stagger and the virtualizer were
 * argued for in review and never once opened in a browser. This spec is that
 * missing check.
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

/** Rooms across the whole seat range: empty, partial, and full. */
const room = (i: number, seated: number, watchers = 0) => ({
  room_code: `TBL${String(i).padStart(3, "0")}`,
  status: seated >= 4 ? "playing" : "open",
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
 * yet. This waits on the one element every state shares, so the assertions
 * that follow are about the screen rather than about webpack.
 */
async function gotoLobby(page: Page) {
  await page.goto("/game-night");
  await expect(page.getByRole("heading", { name: "Tables in play" })).toBeVisible({
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
    await expect(page.getByRole("heading", { name: "Tables in play" })).toBeVisible({
      timeout: 120_000,
    });
    await context.close();
  });

  test("empty lobby draws four seats and the staggered invitation", async ({
    page,
  }) => {
    await stubRooms(page, []);
    await gotoLobby(page);

    await expect(page.getByRole("heading", { name: "No tables running" })).toBeVisible();
    // The stagger animates opacity from 0. If GSAP never ran, or ran and never
    // completed, the seats stay invisible — which is exactly the failure a
    // screenshot-only check would sail past.
    const seats = page.locator("[data-seat]");
    await expect(seats).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await expect(seats.nth(i)).toBeVisible();
      await expect(seats.nth(i)).toHaveCSS("opacity", "1");
    }

    // One primary action on the screen, not two.
    await expect(page.getByRole("button", { name: "Start a table" })).toHaveCount(1);
    await expect(page.getByText("Nothing running right now.")).toBeVisible();

    await page.screenshot({ path: "e2e/results/game-night-empty.png", fullPage: true });
  });

  test("a partial table offers seats, a full one offers watching", async ({ page }) => {
    await stubRooms(page, [room(1, 2, 0), room(2, 4, 7), room(3, 3, 0)]);
    await gotoLobby(page);

    await expect(page.getByText("3 tables going.", { exact: false })).toBeVisible();

    // Two seated, two open — and the empty seats are DRAWN, not omitted.
    const partial = page.locator('a[href="/game-night/room/TBL001"]');
    await expect(partial.getByRole("list")).toHaveAttribute(
      "aria-label",
      "2 of 4 seats taken",
    );
    await expect(partial.getByRole("listitem")).toHaveCount(4);
    await expect(partial.getByText("2 seats open")).toBeVisible();

    // A full table is never disabled; it is a different offer.
    const full = page.locator('a[href="/game-night/room/TBL002"]');
    await expect(full.getByText("Watch", { exact: true })).toBeVisible();
    await expect(full.getByText("7 watching")).toBeVisible();
    await expect(full).toBeEnabled();

    // Singular vs plural is a real branch in seatsLeft's consumer.
    await expect(
      page.locator('a[href="/game-night/room/TBL003"]').getByText("1 seat open"),
    ).toBeVisible();

    await page.screenshot({ path: "e2e/results/game-night-rooms.png", fullPage: true });
  });

  test("the virtualizer windows a long lobby and scrolls to the end", async ({
    page,
  }) => {
    const many = Array.from({ length: 60 }, (_, i) => room(i, i % 5));
    await stubRooms(page, many);
    await gotoLobby(page);

    await expect(page.getByText("60 tables going.", { exact: false })).toBeVisible();

    // Windowing is the whole point: 60 rooms must not mean 60 rows in the DOM.
    const rows = page.locator('a[href^="/game-night/room/"]');
    const rendered = await rows.count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(many.length);

    // measureElement has to settle, or the last row sits past the scroll
    // height and can never be reached.
    const scroller = page.locator("div.overflow-y-auto");
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(page.locator('a[href="/game-night/room/TBL059"]')).toBeVisible();

    await page.screenshot({ path: "e2e/results/game-night-virtualized.png" });
  });

  test("a failed read says connection, not empty lobby", async ({ page }) => {
    await page.route(RPC, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    await gotoLobby(page);

    await expect(page.getByText("Could not load the rooms")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No tables running" })).toHaveCount(0);
  });
});
