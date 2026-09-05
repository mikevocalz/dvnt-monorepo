/**
 * 1:1 call surface (P13 WS-4) — the parts provable in one browser.
 *
 * Ground truth (recon 2026-09-04): the web call screen is
 * packages/app/features/call/call.web.tsx — NOT the calls/ui/** stage system,
 * which is native-only. It uses the REAL @fishjam-cloud/react-client, so a
 * connected two-party call needs a live backend + a second participant and is
 * out of scope here. What one browser CAN prove: the route renders authed, the
 * stage is never blank (some status text always shows), and every in-call
 * control carries an accessible name (call.web.tsx:132-138).
 */

import { test, expect } from "@playwright/test";
import { collectPageErrors, gotoAuthed } from "../support/session";

const ROOM = "audit-e2e-solo-room";

test.describe("1:1 call (solo — no remote party)", () => {
  test("an outgoing audio call renders a non-blank stage", async ({ page }) => {
    const errors = collectPageErrors(page);
    // isOutgoing so the screen enters its own connecting flow rather than
    // waiting to answer; callType=audio so no camera permission is needed.
    await gotoAuthed(page, `/feed/call/${ROOM}?isOutgoing=true&callType=audio`);

    // The stage must never be blank (Zoom "Joining…" rule): some status text is
    // always on screen. Recon: "Connecting…" / "Waiting for others…" (L421-430).
    await expect(
      page.getByText(/connecting|waiting for others|call failed/i).first(),
    ).toBeVisible();

    // No fatal JS on the page even though the room will never connect solo.
    // (A genuine "peer left"/backend error is fine; a pageerror is not.)
    expect(errors.filter((e) => e.startsWith("pageerror:"))).toEqual([]);
  });

  test("the in-call controls expose accessible names", async ({ page }) => {
    await gotoAuthed(page, `/feed/call/${ROOM}?isOutgoing=true&callType=audio`);

    // These are real <button>s with aria-label (ControlButton, L132-138) — the
    // one thing that is solid on this screen. End call is the always-present one.
    await expect(page.getByRole("button", { name: /end call/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /mute microphone|unmute microphone/i }),
    ).toBeVisible();
  });

  test.describe("findings (documented)", () => {
    // E2E-CALL-1 — a hard product gap, not a11y. P13 WS-4 requires "answer a
    // video call as audio-only". The incoming overlay
    // (incoming-call-overlay.web.tsx) has a single "Accept" button and no
    // audio-only option, and Accept routes to /feed/call/${id} WITHOUT
    // callType, so every answered call defaults to video. There is no way to
    // reach the overlay solo (it needs a real incoming call), so this is
    // recorded here and asserted at the source in a follow-up, not run.
    test.fixme("incoming overlay offers Answer audio-only", async () => {});

    // E2E-CALL-2 — a11y. The status text (Connecting/Waiting) is a plain <p>,
    // no role="status"/aria-live, so a screen-reader user gets no announcement
    // when the call phase changes (call.web.tsx:449,488).
    test.fixme("call status is announced via a live region", async ({ page }) => {
      await gotoAuthed(page, `/feed/call/${ROOM}?isOutgoing=true&callType=audio`);
      await expect(page.getByRole("status")).toContainText(/connecting|waiting/i);
    });
  });
});
