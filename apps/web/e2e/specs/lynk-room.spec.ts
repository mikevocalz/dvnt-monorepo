/**
 * Sneaky Lynk room (P13 WS-5) — the parts provable in one browser.
 *
 * Ground truth (recon 2026-09-04): the room runs on the real Fishjam transport,
 * so a CONNECTED multi-tile room needs a second participant. One browser proves:
 * create + room + billing render authed, the connecting/pre-join phase shows a
 * status (never blank), and the control bar carries accessible names
 * (room-stage.tsx ControlButton sets aria-label). There is NO hard entitlement
 * gate on join — a free host gets a 5-minute timer, not a wall (room.web.tsx
 * :906-912), and the audit account has no subscription rows, so it is a free host.
 */

import { test, expect } from "@playwright/test";
import { collectPageErrors, gotoAuthed } from "../support/session";

test.describe("sneaky lynk (solo)", () => {
  test("create and billing screens render authed", async ({ page }) => {
    for (const route of ["/feed/sneaky-lynk/create", "/feed/sneaky-lynk/billing"]) {
      const errors = collectPageErrors(page);
      await gotoAuthed(page, route);
      expect(errors.filter((e) => e.startsWith("pageerror:")), route).toEqual([]);
    }
  });

  test("a room entered as host shows a non-blank stage", async ({ page }) => {
    // isHost=1 so the screen builds the host pre-join/stage rather than waiting
    // on a real invite; the room id is synthetic so the transport never lands.
    await gotoAuthed(
      page,
      "/feed/sneaky-lynk/room/audit-e2e-room?title=AUDIT&hasVideo=0&isHost=1",
    );
    // Something is always on screen: a connecting spinner, a pre-join panel, or
    // a "couldn't join" error — never a blank stage.
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(
      page
        .getByText(/connecting|joining|couldn't join|lynk|leave/i)
        .first(),
    ).toBeVisible();
  });

  test.describe("findings (documented)", () => {
    // E2E-LYNK-1 — a11y. Toggle buttons (mic/camera/hand) convey active/muted
    // state by colour + icon only, with no aria-pressed (recon §7), so a screen
    // reader cannot tell a muted mic from a live one.
    test.fixme("mic/camera toggles expose pressed state", async () => {});

    // E2E-LYNK-2 — a11y. TimeUpDialog (the free-tier 5-min limit) is not a
    // role="dialog"/aria-modal and does not trap focus, unlike EjectModal which
    // is a proper role="alertdialog" (recon §7). Reaching it solo requires
    // waiting out a 5-minute timer, so it is recorded, not run here.
    test.fixme("free-tier time-up dialog is a modal dialog", async () => {});

    // E2E-LYNK-3 — a11y. The connecting spinner has no role="status"/live
    // region, so the phase change is silent to assistive tech.
    test.fixme("connecting state is announced", async ({ page }) => {
      await gotoAuthed(
        page,
        "/feed/sneaky-lynk/room/audit-e2e-room?title=AUDIT&hasVideo=0&isHost=1",
      );
      await expect(page.getByRole("status")).toBeVisible();
    });
  });
});
