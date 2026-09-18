/**
 * Door scanner — the rendered route, decoding a real QR through a fake camera.
 *
 * Chrome is pointed at a Y4M of an actual QR code (generated in
 * support/media-fixtures.ts, decode-verified against zxing-wasm), so this
 * exercises the whole chain the door depends on: expo-camera's web decode loop,
 * the self-hosted WASM, the scan gate, and the screen's check-in path. The
 * browser lab covers the engine in isolation; this covers it mounted.
 *
 * Both edge functions are stubbed at `/api/fn/*` — the same-origin proxy web
 * uses (packages/supabase/src/client.web.ts:178). Stubbing is what makes the
 * assertions mean something: the point is to count how many times the scanner
 * decides to check a ticket in, which a live server would make non-deterministic
 * and which no amount of retrying could pin down.
 */

import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { QR_FIXTURE, QR_FIXTURE_TOKEN } from "../support/media-fixtures";

// Chrome must be launched against the QR clip rather than the default talking
// head, so this file overrides the project's launch args.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${QR_FIXTURE}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
  permissions: ["camera"],
});

const EVENT_ID = "00000000-0000-4000-8000-00000000d00r";
const SCANNER_URL = `/feed/events/${EVENT_ID}/scanner`;

/** The roster read that `useEventRole` reads the role out of. */
async function stubStaffRole(page: Page) {
  await page.route("**/api/fn/get-event-tickets**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        role: "scanner",
        tickets: [],
        total: 0,
        page: 1,
        pageSize: 1,
        hasMore: false,
      }),
    }),
  );
}

/** Counts check-in attempts; every call admits. */
async function stubAdmittingScan(page: Page): Promise<() => number> {
  let calls = 0;
  await page.route("**/api/fn/ticket-scan**", (route) => {
    calls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        valid: true,
        // `name` is resolved server-side from attendee_name / account /
        // guest_name (ticket-scan/index.ts:486-492) — the client reads
        // `ticket.name`, not the raw column.
        ticket: { id: "t1", name: "Jamie Cole", tier_name: "GA" },
      }),
    });
  });
  return () => calls;
}

async function stubEvent(page: Page) {
  await page.route("**/rest/v1/events**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: EVENT_ID, title: "Door rehearsal", user_id: "someone" }]),
    }),
  );
}

/** Navigate and wait for the scanner to be live, not merely routed. */
async function gotoLobbyScanner(page: Page) {
  await page.goto(SCANNER_URL);
  await expect(page.getByRole("heading", { name: "Scanner" })).toBeVisible({
    timeout: 60_000,
  });
}

test.describe("door scanner", () => {
  // The scanner route is a client screen behind a role gate; a cold compile of
  // it plus expo-camera plus the WASM does not fit the suite's default budget.
  test.describe.configure({ timeout: 150_000 });

  test("decodes a held-up code and checks it in exactly once", async ({ page }) => {
    await stubEvent(page);
    await stubStaffRole(page);
    const scanCalls = await stubAdmittingScan(page);

    const scanned: string[] = [];
    await page.route("**/api/fn/ticket-scan**", async (route) => {
      scanned.push(route.request().postData() ?? "");
      await route.fallback();
    });

    await page.goto(SCANNER_URL);

    // The verdict, not a log line, is the proof the whole chain worked.
    await expect(page.getByText(/Admitted/)).toBeVisible({ timeout: 60_000 });
    // Twice by design — on the verdict card and in the recent-scans list under
    // it — so this is scoped rather than made strict. The name is what door
    // staff match to the face, and it comes from the server's resolved
    // `ticket.name`: the field patch 01 taught ticket-scan to fill from
    // guest_name, so guest-checkout orders stop reading "Guest".
    await expect(page.getByText("Jamie Cole").first()).toBeVisible();

    // The token that came off the camera is the one in the fixture — this is
    // what separates "something decoded" from "the right thing decoded".
    expect(scanned.join(" ")).toContain(QR_FIXTURE_TOKEN);

    // The fixture holds the code in frame for 4s and Chrome loops it, while
    // expo-camera decodes every 300ms (ExpoCamera.web.tsx:61). Without the scan
    // gate that is a dozen-plus check-ins of one guest; the door rule is one
    // presentation, one scan.
    await page.waitForTimeout(3000);
    expect(scanCalls()).toBe(1);
  });

  test("stops decoding while a verdict is up", async ({ page }) => {
    await stubEvent(page);
    await stubStaffRole(page);
    const scanCalls = await stubAdmittingScan(page);

    await page.goto(SCANNER_URL);
    await expect(page.getByText(/Admitted/)).toBeVisible({ timeout: 60_000 });

    // The camera is still mounted and the code is still in frame. `paused`
    // feeds onBarcodeScanned={undefined}, which is how expo-camera's web
    // scanner is switched off (ExpoCamera.web.tsx:54-58) without tearing down
    // the stream. Nothing may be checked in behind the card.
    const before = scanCalls();
    await page.waitForTimeout(4000);
    expect(scanCalls()).toBe(before);
    await expect(page.getByText(/Admitted/)).toBeVisible();
  });

  test("?engine=legacy runs the old scanner, with no deploy", async ({ page }) => {
    await stubEvent(page);
    await stubStaffRole(page);
    await stubAdmittingScan(page);

    await page.goto(`${SCANNER_URL}?engine=legacy`);

    // The door's escape hatch has to be provable, not asserted in a comment:
    // the engine in the DOM is the legacy one, and the CameraView rewrite is
    // not mounted at all.
    await expect(page.locator('[data-qr-engine="legacy"]')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('[data-qr-engine="modern"]')).toHaveCount(0);
  });

  test("going offline queues the scan and says so, then drains on reconnect", async ({
    page,
    context,
  }) => {
    await stubEvent(page);
    await stubStaffRole(page);
    const scanCalls = await stubAdmittingScan(page);

    await gotoLobbyScanner(page);
    await expect(page.getByText(/Admitted/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /dismiss scan result/i }).click();

    // The venue's signal drops mid-shift. Scanning must keep working, and the
    // row has to say what happened to the scans — a door that silently queues
    // is indistinguishable from one that silently loses them.
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("status").filter({ hasText: /Offline/ })).toBeVisible({
      timeout: 15_000,
    });

    // Back online: the row must return to a non-offline state by itself. This
    // is the wiring that did not exist on web at all — initOfflineScanAutoDrain
    // is only ever called from the native root layout.
    const before = scanCalls();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(
      page.getByRole("status").filter({ hasText: /Offline/ }),
    ).toHaveCount(0, { timeout: 20_000 });
    expect(scanCalls()).toBeGreaterThanOrEqual(before);
  });

  test("the guest list finds a name the camera cannot, and checks in through the same path", async ({
    page,
  }) => {
    await stubEvent(page);
    const scanCalls = await stubAdmittingScan(page);

    // A roster with one guest already in and one still outside. `qr_token` is
    // present because get-event-tickets returns it to scanner-role callers.
    await page.route("**/api/fn/get-event-tickets**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          // `ok` is load-bearing: getEventTicketsPaginated reads
          // `data?.ok ? data.tickets : []` but takes `role` unconditionally,
          // so omitting it yields a roster of zero with the gate still open.
          ok: true,
          role: "scanner",
          total: 2,
          page: 1,
          pageSize: 200,
          hasMore: false,
          tickets: [
            {
              id: "1",
              status: "scanned",
              qr_token: "TOK-IN",
              holder_name: "Ada Okonkwo",
              ticket_type_name: "GA",
              checked_in_at: new Date(Date.now() - 19 * 60_000).toISOString(),
            },
            {
              id: "2",
              status: "active",
              qr_token: "TOK-OUT",
              holder_name: "Bo Mensah",
              ticket_type_name: "VIP",
              checked_in_at: null,
            },
            // A second ticket for the same person. On the real door 22 people
            // hold more than one and one holds five, so identical rows are the
            // normal case, not an edge case.
            {
              id: "3",
              status: "active",
              qr_token: "TOK-OUT-2",
              holder_name: "Bo Mensah",
              ticket_type_name: "VIP",
              checked_in_at: null,
            },
          ],
        }),
      }),
    );

    await gotoLobbyScanner(page);
    await page.getByRole("button", { name: "Guest list" }).click();

    // Counts come off the same query the progress bar reads.
    await expect(page.getByRole("button", { name: "All 3" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Checked in 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Not in yet 2" })).toBeVisible();

    // Two identical names must be tellable apart, or staff cannot know which
    // of a guest's tickets they just admitted.
    await expect(page.getByText(/ticket 1 of 2/)).toBeVisible();
    await expect(page.getByText(/ticket 2 of 2/)).toBeVisible();

    // Already in: a state, with when — the fact that settles an argument.
    await expect(page.getByText(/In · 19 min ago/)).toBeVisible();

    // Name search, which the SERVER cannot do — it matches qr_token prefix
    // only. This is why the roster is filtered client-side.
    await page.getByPlaceholder("Search a name, or the ticket code").fill("bo");
    await expect(page.getByText("Ada Okonkwo")).toHaveCount(0);
    await expect(page.getByText("Bo Mensah").first()).toBeVisible();

    // Checking in from a row goes through the same ticket-scan call the camera
    // uses — one check-in path, whichever way the door found the ticket.
    const before = scanCalls();
    // Two rows, two buttons — checking one in must admit exactly one ticket,
    // not both and not the wrong one.
    await page.getByRole("button", { name: "Check in" }).first().click();
    await expect.poll(() => scanCalls()).toBe(before + 1);
  });

  test("a used ticket reads as used, and an unreachable server as unchecked", async ({
    page,
  }) => {
    await stubEvent(page);
    await stubStaffRole(page);

    // The server answered: this ticket was already used. That is a refusal,
    // and it must NOT read as a forgery — a guest who already went in is not
    // someone carrying a fake.
    await page.route("**/api/fn/ticket-scan**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          valid: false,
          reason: "already_scanned",
          checked_in_at: new Date(Date.now() - 12 * 60_000).toISOString(),
        }),
      }),
    );
    await gotoLobbyScanner(page);
    // Twice by design: the verdict card and the recent-scans row beneath it.
    // Scoped to the verdict card, not the page: the recent-scans list below it
    // legitimately keeps showing past outcomes.
    const card = page.locator("[data-verdict]");
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toHaveAttribute("data-verdict", "rejected");
    await expect(card).toContainText(/Already scanned/i);
    // The two failures that must never be confused: a used ticket is not a
    // forgery, and it is not an unanswered scan.
    await expect(card).not.toContainText(/Not a ticket/i);
    await expect(card).not.toContainText(/Not checked in/i);

    // A 500 is not a verdict about the ticket. It must say so, in words, not
    // only by turning amber.
    //
    // Local knowledge is cleared first, and that is the point rather than test
    // hygiene: having just seen this token used, the device correctly keeps
    // painting "Already scanned" from its own offline set even when the server
    // stops answering. The no-verdict case is a device that knows NOTHING
    // about the ticket in front of it.
    // ONLY the offline check-in store. `localStorage.clear()` also wipes the
    // persisted auth session, so the reload lands on the signed-out gate and
    // the scanner never mounts — which is what happened the first time.
    await page.evaluate(() =>
      window.localStorage.removeItem("offline-checkin-store"),
    );
    await page.unroute("**/api/fn/ticket-scan**");
    await page.route("**/api/fn/ticket-scan**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: "{}" }),
    );
    await page.reload();
    const amber = page.locator("[data-verdict]");
    await expect(amber).toBeVisible({ timeout: 60_000 });
    await expect(amber).toHaveAttribute("data-verdict", "no_verdict");
    await expect(amber).toContainText(/^Not checked in/);
    await expect(amber).not.toContainText(/Already scanned/i);
  });

  test("the gate tells three different problems apart", async ({ page }) => {
    await stubEvent(page);

    // 403 — the server answered, and the answer was no. The only real refusal.
    await page.route("**/api/fn/get-event-tickets**", (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: "{}" }),
    );
    await page.goto(SCANNER_URL);
    await expect(
      page.getByRole("heading", { name: /not on door staff/i }),
    ).toBeVisible({ timeout: 60_000 });
    // The account being refused, which is usually the whole problem.
    await expect(page.getByText(/Signed in as /)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in as someone else" })).toBeVisible();

    // No answer at all. This says nothing about the staffer, so it must not
    // read as a refusal — and it must not claim they were removed from a door
    // they are standing at.
    await page.unroute("**/api/fn/get-event-tickets**");
    await page.route("**/api/fn/get-event-tickets**", (route) => route.abort());
    await page.reload();
    await expect(
      page.getByRole("heading", { name: /can.t check your access offline/i }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText(/not on door staff/i)).toHaveCount(0);
  });

  test("a dead decode engine is a readable panel, not a black camera", async ({
    page,
  }) => {
    await stubEvent(page);
    await stubStaffRole(page);
    await stubAdmittingScan(page);

    // Chrome ships a native BarcodeDetector that supports qr_code, so on this
    // browser prepareQrEngine() resolves to "native" and never touches the
    // WASM — blocking it alone would prove nothing. Removing the native
    // detector puts Chrome on the same path as Safari, which has none, and
    // which is the browser the door actually runs on.
    await page.addInitScript(() => {
      delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
    });
    // Then both sources of the reader WASM: the self-hosted copy and the CDN
    // fallback. expo-camera never surfaces a decode failure itself — it does
    // not pass `onError` to its scan loop at all — so without the engine
    // preload this state is a live preview that silently never reads.
    await page.route("**/vendor/zxing/**", (route) => route.abort());
    await page.route("**/*jsdelivr*/**", (route) => route.abort());

    await page.goto(SCANNER_URL);

    await expect(page.getByText("Scanner engine didn't load")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    // The door must never need a redeploy to change engines.
    await expect(
      page.getByRole("button", { name: "Switch scanner engine" }),
    ).toBeVisible();
  });
});
