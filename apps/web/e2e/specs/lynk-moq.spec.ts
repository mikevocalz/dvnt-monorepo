/**
 * Sneaky Lynk room — the MoQ transport, against a REAL relay.
 *
 * The sibling spec (`lynk-room.spec.ts`) checks the room renders. This one
 * checks the thing that actually changed when the room left Fishjam: that a
 * publish token mints, `Moq.Connection.Reload` reaches the relay, the local
 * capture flows, and the new client-side VAD lights the speaking ring.
 *
 * Chrome's fake devices make that assertable rather than merely observable —
 * `speech.wav` is real speech, so `useSpeakingDetection`'s RMS + hysteresis has
 * something to detect, and `talking-head.y4m` gives the local <video> real
 * frames. Both are wired in playwright.config.ts for every authed project.
 *
 * These create REAL rooms on the live project, so every test leaves through the
 * host's own Leave button in a `finally` — a host leaving calls `endRoom`, and
 * an abandoned room stays listed as Live. Nothing here contacts another account.
 *
 * What still needs a SECOND identity (see `two clients` at the bottom): a remote
 * canvas painting frames, a remote speaking ring arriving over the Supabase
 * channel, and the listener path (`canPublish` false). One account cannot stand
 * in — `coPublishers` filters out our own peer id, so a second tab on the same
 * account sees zero co-publishers by construction.
 */

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { collectPageErrors } from "../support/session";

const PEER_STATE = path.join(__dirname, "../.auth/peer.json");

/** Records every getUserMedia constraint the page asks for, before app code runs. */
async function spyOnGetUserMedia(page: Page) {
  await page.addInitScript(() => {
    (window as any).__gum = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => {
      (window as any).__gum.push({ video: !!c?.video, audio: !!c?.audio });
      return real(c);
    };
  });
}

const gumCalls = (page: Page) =>
  page.evaluate(() => (window as any).__gum as { video: boolean; audio: boolean }[]);

/**
 * Create a real Lynk through the UI and land in it. Returns the room id.
 *
 * "Enable Video" defaults OFF (create-store.ts) — a Lynk is an audio room until
 * the host says otherwise — so `video: true` is the one that clicks. Getting
 * this backwards is how the first run of this spec "found" a missing camera in
 * a room that was correctly audio-only.
 */
async function createRoom(page: Page, title: string, video: boolean): Promise<string> {
  await suppressInstallPrompt(page);
  await page.goto("/feed/sneaky-lynk/create", { waitUntil: "load" });
  await expect(page).not.toHaveURL(/\/auth\//);
  await page.locator("#lynk-title").fill(title);
  const toggle = page.getByRole("switch", { name: "Enable Video" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  if (video) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
  await page.getByRole("button", { name: "Start Lynk" }).click();
  try {
    await page.waitForURL(/\/feed\/sneaky-lynk\/room\/[^/?]+/, { timeout: 30_000 });
  } catch {
    // The rate limiter is the likeliest reason a create silently does nothing,
    // and a bare 30s navigation timeout reads like a broken create screen. Name
    // it instead: video_create_room allows 5 creations per 300s per user
    // (functions/video_create_room/index.ts, check_rate_limit).
    const limited = await page.getByText(/too many room creations/i).count();
    throw new Error(
      limited
        ? "video_create_room rate-limited (5 creations / 5 min). Wait out the window before re-running this spec."
        : `create did not reach a room; still on ${page.url()}`,
    );
  }
  return new URL(page.url()).pathname.split("/").pop()!;
}

/**
 * Pre-set the PWA promo's dismissal flag so it never opens.
 *
 * "Use DVNT like an app" is a MODAL on a 1.5s timer
 * (components/pwa-install.web.tsx:138) and on a fresh profile it lands straight
 * over the Lynk pre-join screen, with "Join Lynk" behind it. The audit account's
 * storage state had dismissed it long ago, so only the second identity ever met
 * it — the exact class of bug a one-account test cannot see.
 *
 * Setting the flag beats clicking "Not now": the click races the timer, and a
 * test that sometimes wins that race is worse than one that never runs it.
 *
 * Product note, not test friction: a first-time visitor opening a room link
 * meets an install ad over the join button 1.5s in.
 */
const PWA_DISMISS_KEY = "dvnt-pwa-install-dismissed";

async function suppressInstallPrompt(target: Page | BrowserContext) {
  await target.addInitScript((key) => {
    try {
      localStorage.setItem(key, "1");
    } catch {
      // A context with storage blocked still runs the test; the promo is not
      // what is under test.
    }
  }, PWA_DISMISS_KEY);
}

/** Host leave → `endRoom`. Best-effort: a failed cleanup must not mask a failure. */
async function leaveRoom(page: Page) {
  try {
    await page.getByRole("button", { name: "Leave Lynk" }).first().click({ timeout: 5_000 });
    // Wait for the navigation the host leave triggers, not a fixed guess — the
    // endRoom round trip is what actually closes the room, and cutting it short
    // leaves the Lynk listed as Live.
    await page.waitForURL((u) => !/\/sneaky-lynk\/room\//.test(u.pathname), {
      timeout: 15_000,
    });
  } catch {
    // The room may already be gone (error phase); the test result stands.
  }
}

test.describe("sneaky lynk — MoQ transport", () => {
  // A relay handshake plus a publish-token round trip is slower than a render.
  // `configure`, not `test.setTimeout` — the latter in a describe body is a
  // no-op and every test still died at the 30s default.
  test.describe.configure({ timeout: 180_000 });

  test("a host connects, publishes, and its own VAD lights the ring", async ({ page }) => {
    const errors = collectPageErrors(page);
    await spyOnGetUserMedia(page);
    let roomId = "";
    try {
      roomId = await createRoom(page, `E2E MoQ video ${Date.now()}`, true);

      // 1. The room leaves "Connecting…". This is the phase-gating fix: the
      //    screen used to sit on a spinner until media landed.
      await expect(page.getByRole("button", { name: /^(Mute|Unmute)$/ })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByText("Connecting…")).toHaveCount(0);

      // 2. Capture really started — a publish-capable role opened both devices.
      //    POLLED, not asserted once: the control bar now appears as soon as the
      //    role lands, which is deliberately BEFORE the publish token mints and
      //    the devices open. Asserting here immediately just races the room.
      await expect
        .poll(async () => (await gumCalls(page)).some((c) => c.audio), {
          timeout: 30_000,
          message: "the microphone was never requested for a publishing host",
        })
        .toBe(true);
      await expect
        .poll(async () => (await gumCalls(page)).some((c) => c.video), {
          timeout: 30_000,
          message: "the camera was never requested in a video room",
        })
        .toBe(true);

      // 3. The local tile is rendering the fake camera, not a frozen element.
      const localVideo = page.locator('[data-tile="local"] video');
      await expect(localVideo).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => localVideo.evaluate((v: HTMLVideoElement) => v.videoWidth), {
          timeout: 30_000,
          message: "the local <video> never received a frame from the capture",
        })
        .toBeGreaterThan(0);

      // 4. THE NEW PATH: speech.wav → AnalyserNode → decideSpeaking → the ring.
      //    Fishjam got this from the server; nothing on MoQ does.
      await expect
        .poll(
          () =>
            page.locator('[data-tile="local"]').getAttribute("data-speaking"),
          {
            timeout: 30_000,
            message:
              "the local tile never reported speaking — client-side VAD is not reaching the tile",
          },
        )
        .toBe("true");
    } finally {
      await leaveRoom(page);
    }

    expect(errors.filter((e) => e.startsWith("pageerror:")), `room ${roomId}`).toEqual([]);
  });

  test("an audio-only room never opens the camera", async ({ page }) => {
    // The regression this guards: `useLynkBroadcast.web` used to construct
    // `Publish.Source.Camera({ enabled: true })` at mount, so the camera opened
    // before the role was even known — a permission prompt for a device this
    // room cannot use.
    await spyOnGetUserMedia(page);
    try {
      await createRoom(page, `E2E MoQ audio ${Date.now()}`, false);
      await expect(page.getByRole("button", { name: /^(Mute|Unmute)$/ })).toBeVisible({
        timeout: 60_000,
      });

      // Give the transport time to do the wrong thing before asserting it did not.
      await page.waitForTimeout(5_000);
      const gum = await gumCalls(page);
      expect(gum.some((c) => c.audio), "no microphone in an audio room").toBe(true);
      expect(
        gum.filter((c) => c.video),
        "an audio-only room asked for the camera",
      ).toEqual([]);
    } finally {
      await leaveRoom(page);
    }
  });

  test("two clients: a listener does not hang, and a promoted peer paints and speaks", async ({
    page,
    browser,
  }) => {
    // Needs a second REAL identity — see peer.setup.ts for why one account
    // cannot stand in. Skips cleanly when it is not configured.
    test.skip(
      !fs.existsSync(PEER_STATE),
      "no peer identity: set E2E_PEER_EMAIL / E2E_PEER_PASSWORD in apps/web/.env.e2e.local",
    );

    const peerCtx = await browser.newContext({
      storageState: PEER_STATE,
      permissions: ["camera", "microphone"],
    });
    await suppressInstallPrompt(peerCtx);
    const peer = await peerCtx.newPage();
    let roomId = "";

    try {
      // ── Host publishes ────────────────────────────────────────────────────
      roomId = await createRoom(page, `E2E MoQ pair ${Date.now()}`, true);
      await expect(page.locator('[data-tile="local"]')).toBeVisible({ timeout: 60_000 });

      // ── Peer joins as a plain participant → canPublish false ─────────────
      // THE LISTENER REGRESSION: with no publish token, `deriveLynkState`
      // reported `requesting-token` forever and the room never left its
      // spinner. Reaching the stage at all is the assertion.
      await peer.goto(`/feed/sneaky-lynk/room/${roomId}?hasVideo=1`, { waitUntil: "load" });
      // A non-creator always meets the pre-join gate. WAIT for it — `count()`
      // is an instant check with no auto-wait, and this route is `ssr: false`,
      // so at `load` the React tree has not mounted and the button count is 0.
      // The old code silently skipped the click and then blamed the stage.
      const joinButton = peer.getByRole("button", { name: /^join lynk$/i });
      await expect(
        joinButton,
        "the peer never reached the pre-join gate",
      ).toBeVisible({ timeout: 30_000 });
      await joinButton.click();
      await expect(
        peer.locator('[data-tile="local"]'),
        "a listener never reached the stage — the publish-token state trap is back",
      ).toBeVisible({ timeout: 60_000 });

      // A listener publishes nothing, so it must never open a device.
      await expect(peer.locator('[data-tile="local"] video')).toHaveCount(0);

      // The host sees them — in the AUDIENCE, not on the stage. A listener has
      // no media to show, and putting them in the speaker grid is what made
      // every participant render twice.
      await expect(
        page.locator("[data-listener]"),
        "the host does not see the listener in the audience row",
      ).toHaveCount(1, { timeout: 30_000 });
      await expect(
        page.locator('[data-tile]:not([data-tile="local"])'),
        "a listener should not occupy a stage tile",
      ).toHaveCount(0);

      // ── Host promotes the peer → they publish ────────────────────────────
      await page.getByRole("button", { name: "Participants" }).click();
      // The panel's accessible name is "Make <name> a co-host"
      // (ui/web/room-panels.tsx:468) — not "promote", which is the prop name,
      // not the label. Match the real copy.
      const promote = page.getByRole("button", { name: /make .* a co-host/i }).first();
      await expect(
        promote,
        "the host cannot see a promote action for the peer",
      ).toBeVisible({ timeout: 30_000 });
      await promote.click();

      // ── Remote media actually arrives ────────────────────────────────────
      // The canvas is sized by the DECODER, so an intrinsic size that is no
      // longer the 300x150 HTML default is proof a frame was decoded and
      // painted. Reading pixels back is not reliable across the renderer's
      // backing store; this is.
      // Promotion moves them from the audience onto the stage.
      const peerTile = page.locator('[data-tile]:not([data-tile="local"])').first();
      await expect(
        peerTile,
        "the promoted co-host never reached the stage",
      ).toBeVisible({ timeout: 60_000 });
      const peerCanvas = peerTile.locator("canvas");
      await expect(peerCanvas).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(
          () =>
            peerCanvas.evaluate(
              (c: HTMLCanvasElement) => `${c.width}x${c.height}`,
            ),
          {
            timeout: 60_000,
            message: "the remote canvas never left its default size — no frame decoded",
          },
        )
        .not.toBe("300x150");

      // ── Speaking presence crosses the Supabase channel ───────────────────
      // The peer's own VAD reads its fake mic and broadcasts the boolean; this
      // asserts the HOST received it. Nothing in MoQ carries this.
      await expect
        .poll(() => peerTile.getAttribute("data-speaking"), {
          timeout: 60_000,
          message:
            "the host never saw the peer speaking — useSpeakingPresence is not crossing the channel",
        })
        .toBe("true");
    } finally {
      await leaveRoom(peer).catch(() => {});
      await peerCtx.close();
      await leaveRoom(page);
    }
  });
});
