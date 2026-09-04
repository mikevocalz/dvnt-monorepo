/**
 * Event creation composer — form render, required-field gating, and a11y of the
 * controls. Does NOT publish: a published event is real production data behind
 * an owner-scoped teardown, and everything worth asserting about the composer
 * (that it renders authed, that publish is gated, that its controls are
 * reachable) is provable without creating a row.
 *
 * Ground truth (recon 2026-09-04): both /events/create and /feed/events/create
 * render the same CreateEventScreen (event-create.web.tsx). Required to publish:
 * Title, Type, Start, Location-or-Online (event-form.ts:143-175). Publish is a
 * <button> with text "Publish", no aria-label. The visibility/age toggle groups
 * are role-less <button>s with colour-only selection — invisible to AT.
 */

import { test, expect } from "@playwright/test";
import { collectPageErrors, gotoAuthed } from "../support/session";

test.describe("event composer (authed, no publish)", () => {
  test("both create routes render the same authed composer", async ({ page }) => {
    for (const route of ["/events/create", "/feed/events/create"]) {
      const errors = collectPageErrors(page);
      await gotoAuthed(page, route);
      // Title is the one field the recon confirms is a real textbox with a name.
      // Named by placeholder, not the visible "Event title *" label — the
      // label is an unbound <generic> (finding E2E-EVT-1, fixme below).
      await expect(
        page.getByPlaceholder(/what's the event called/i),
        `${route}: title field`,
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Publish" }),
        `${route}: publish button`,
      ).toBeVisible();
      expect(errors, `console errors on ${route}`).toEqual([]);
    }
  });

  test("the required fields are present and reachable", async ({ page }) => {
    await gotoAuthed(page, "/feed/events/create");

    // Title — named only by placeholder (label unbound, E2E-EVT-1).
    await expect(page.getByPlaceholder(/what's the event called/i)).toBeVisible();
    // Type — a native <select>, real combobox role but ALSO no bound name.
    await expect(page.getByRole("combobox").first()).toBeVisible();
    // Start — datetime-local input, no bound label either. Two exist (start +
    // end), so scope to the first.
    await expect(page.locator('input[type="datetime-local"]').first()).toBeVisible();
  });

  test("publishing an empty form does not silently succeed", async ({ page }) => {
    await gotoAuthed(page, "/feed/events/create");
    const publish = page.getByRole("button", { name: "Publish" });
    await publish.click();

    // The audit sign-off requires blocked publishes to explain themselves, not
    // dim silently (event-creation-audit A3). An empty publish surfaces an
    // alert and stays on the composer — the failure mode to guard against is a
    // silent redirect to a live /events/<id>.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/feed\/events\/create/);
  });

  test.describe("a11y findings (documented, expected-fail)", () => {
    // These encode defects the recon found. They are `.fixme` so the suite stays
    // green while naming the debt precisely — flip to active as each is fixed.
    test.fixme(
      "visibility/age toggles expose a selection role",
      async ({ page }) => {
        await gotoAuthed(page, "/feed/events/create");
        // event-create.web.tsx:841-871 renders these as role-less <button>s with
        // colour-only selection — invisible to assistive tech and to getByRole.
        await expect(
          page.getByRole("radio").or(page.getByRole("switch")).first(),
        ).toBeVisible();
      },
    );

    test.fixme("form fields are named by a bound label, not a placeholder", async ({ page }) => {
      await gotoAuthed(page, "/feed/events/create");
      // E2E-EVT-1: "Event title *" renders as an unbound <generic>; the input's
      // only accessible name is its placeholder, which disappears once typed
      // into. Same for Type/Start/Venue. WCAG 2.1 AA 3.3.2 / 1.3.1.
      await expect(page.getByRole("textbox", { name: /event title/i })).toBeVisible();
    });

    test.fixme("the flyer file inputs have accessible names", async ({ page }) => {
      await gotoAuthed(page, "/feed/events/create");
      // Both slots are hidden <input type=file> with no aria-label / id — a
      // screen reader announces "file, button" with no purpose (recon §7).
      await expect(
        page.getByLabel(/video flyer/i).or(page.getByLabel(/flyer image/i)),
      ).toBeVisible();
    });
  });
});
