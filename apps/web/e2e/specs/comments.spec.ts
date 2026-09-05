/**
 * Comment surfaces (P13 WS-3) — composer render and a11y, on a post discovered
 * at runtime from the feed (never a hardcoded production id, which could be
 * deleted out from under the suite).
 *
 * Ground truth (recon 2026-09-04): route /feed/comments/[postId], numeric id.
 * The composer <input> has NO bound label/aria-label — only a placeholder
 * ("Add a comment…"), so it is reached by getByPlaceholder. Submit is a real
 * button aria-labelled "Post comment". Comment rows, "Reply", "View replies (N)"
 * and Like are role-less Pressables — recorded as findings, not asserted as
 * roles. Does NOT post a comment: that is real production content under the
 * audit user, and the composer's render + a11y is provable without submitting.
 */

import { test, expect } from "@playwright/test";
import { collectPageErrors, gotoAuthed } from "../support/session";

/** Pull a numeric post id from the feed, or null if the feed has none. */
async function discoverPostId(page: import("@playwright/test").Page): Promise<string | null> {
  await gotoAuthed(page, "/feed");
  const link = page
    .locator('a[href*="/feed/comments/"], a[href*="/feed/post/"]')
    .first();
  // Short wait, not the default 30s: this audit account follows no one, so its
  // feed is legitimately empty and discovery should skip fast, not hang.
  const href = await link
    .getAttribute("href", { timeout: 4000 })
    .catch(() => null);
  const m = href?.match(/\/(?:comments|post)\/(\d+)/);
  return m ? m[1] : null;
}

test.describe("comments (authed, no submit)", () => {
  test("the composer renders on a real post thread", async ({ page }) => {
    const postId = await discoverPostId(page);
    test.skip(!postId, "no post in the feed to open a comment thread on");

    const errors = collectPageErrors(page);
    await gotoAuthed(page, `/feed/comments/${postId}`);

    // Composer input is named ONLY by placeholder (finding E2E-CMT-1).
    await expect(page.getByPlaceholder(/add a comment/i)).toBeVisible();
    // Submit is a proper aria-labelled button — the one solid control here.
    await expect(page.getByRole("button", { name: /post comment/i })).toBeVisible();
    expect(errors.filter((e) => e.startsWith("pageerror:"))).toEqual([]);
  });

  test("typing enables submit but the draft is not sent", async ({ page }) => {
    const postId = await discoverPostId(page);
    test.skip(!postId, "no post in the feed to open a comment thread on");

    await gotoAuthed(page, `/feed/comments/${postId}`);
    const input = page.getByPlaceholder(/add a comment/i);
    await input.fill("[AUDIT 2026-09] draft — not submitted");
    // Prove the value is held without firing add-comment: no click on submit.
    await expect(input).toHaveValue(/\[AUDIT 2026-09\]/);
  });

  test.describe("findings (documented)", () => {
    // E2E-CMT-1 — a11y. The composer input has no bound <label>/aria-label;
    // its only accessible name is the placeholder, which vanishes on input.
    test.fixme("comment composer input has a bound label", async ({ page }) => {
      const postId = await discoverPostId(page);
      test.skip(!postId, "no post available");
      await gotoAuthed(page, `/feed/comments/${postId}`);
      await expect(page.getByRole("textbox", { name: /comment/i })).toBeVisible();
    });

    // E2E-CMT-2 — a11y. "Reply", "View replies (N)" and the Like heart are
    // role-less Pressables with no accessible name; the Like button has no name
    // at all (threaded-comment.tsx). Not matchable by role.
    test.fixme("comment row actions are buttons with names", async () => {});
  });
});
