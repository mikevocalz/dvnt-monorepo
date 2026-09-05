/**
 * Playwright harness for the DVNT web verification pass (docs/e2e/phase-0.md).
 *
 * Four viewport projects because the Lynk room is the surface under test and
 * P13 WS-5 requires 375/768/1024/1440. WebKit exists for one reason: autoplay
 * policy. Video flyers are progressive MP4 (Bunny Stream is not provisioned),
 * and Safari is the browser that will refuse to autoplay them if `muted` +
 * `playsInline` ever regress — Chromium will happily hide that bug.
 *
 * Every Chromium project runs on `channel: "chrome"` — the Google Chrome already
 * installed on this machine (152.0.7977.77) — rather than Playwright's bundled
 * build. The bundled download stalls on this host (the out-of-process downloader
 * sits at ~0s CPU indefinitely), and driving real Chrome is closer to what users
 * run anyway. Swap to the bundled build by dropping `channel` if CI needs a
 * version-pinned browser.
 *
 * Media is faked at the browser level so WebRTC specs are deterministic AND
 * assertable: the Y4M/WAV fixtures make tracks non-silent, so an audio-call
 * test can assert RMS > threshold instead of asserting a track merely exists.
 */

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import dotenv from "dotenv";

// Load e2e credentials from the config, not the shell. `source .env.e2e.local`
// breaks the moment a value contains `&` (the App-Store review password does),
// and dotenv parses the raw bytes without shell interpretation.
dotenv.config({ path: path.join(__dirname, ".env.e2e.local") });

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const fixture = (f: string) => path.join(__dirname, "e2e/fixtures", f);

// Chromium needs the fake devices wired to real files; without the file args it
// synthesises a silent green frame and every media assertion passes vacuously.
const fakeMediaArgs = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  `--use-file-for-fake-video-capture=${fixture("talking-head.y4m")}`,
  `--use-file-for-fake-audio-capture=${fixture("speech.wav")}`,
  "--autoplay-policy=no-user-gesture-required",
];

export default defineConfig({
  testDir: "./e2e/specs",
  // Writes the fake-capture fixtures below if they are absent. They were
  // missing outright until 2026-09-04, and Chrome does not complain about a
  // bad --use-file-for-fake-*-capture path: it silently produces no video
  // track and silent audio, so every media assertion fails looking like an app
  // bug. Generating them is also why they are not committed — raw Y4M is
  // uncompressed.
  globalSetup: "./e2e/support/media-fixtures.ts",
  // Serial: every spec drives ONE shared audit account against a shared
  // backend. Parallel runs would race each other's rooms, RSVPs and drafts.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "e2e/report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  outputDir: "e2e/results",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    // Video is off, not "retain-on-failure": it needs Playwright's bundled
    // ffmpeg, which is part of the same download that stalls on this host. The
    // trace already carries a DOM+screenshot timeline you can scrub, which is
    // strictly more debuggable than an mp4. Turn it back on if ffmpeg lands.
    video: "off",
    screenshot: "only-on-failure",
  },

  projects: [
    // Mints the storage state every other project reuses (P13 WS-1).
    {
      name: "setup",
      // Both identities. `peer.setup.ts` skips itself when its credentials are
      // absent, so a machine with only the audit account is unaffected.
      testMatch: /(auth|peer)\.setup\.ts/,
      // Needs the channel too — without a `use` block it falls back to the
      // bundled Chromium that will not download on this host.
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },

    // Unauthenticated lane. Deliberately has NO setup dependency and no
    // storage state: the login page, the public event page and `/` must all
    // render for a signed-out visitor, and gating them behind the audit
    // account would mean never testing the state a first-time user arrives in.
    {
      name: "public-1440",
      testMatch: /public\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"],
        channel: "chrome", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "public-375",
      testMatch: /public\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"],
        channel: "chrome", viewport: { width: 375, height: 812 } },
    },

    {
      name: "chromium-desktop-1440",
      testIgnore: /public\//,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
        permissions: ["camera", "microphone"],
      },
    },
    {
      name: "chromium-tablet-1024",
      testIgnore: /public\//,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1024, height: 768 },
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
        permissions: ["camera", "microphone"],
      },
    },
    {
      name: "chromium-tablet-768",
      testIgnore: /public\//,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 768, height: 1024 },
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
        permissions: ["camera", "microphone"],
      },
    },
    {
      name: "chromium-mobile-375",
      testIgnore: /public\//,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 375, height: 812 },
        isMobile: false, // Chromium desktop channel; touch emulation is per-spec
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
        permissions: ["camera", "microphone"],
      },
    },
    {
      // Autoplay/poster cases only — WebKit cannot fake media devices the way
      // Chromium can, so WebRTC specs are excluded from this project by tag.
      name: "webkit-media",
      // No testIgnore: `grep: /@media/` already scopes this project to tagged
      // tests wherever they live, and its @media specs sit under specs/public/.
      // No setup dependency: it runs signed-out.
      grep: /@media/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        // Signed-out: these are public autoplay/render checks, and it removes
        // the setup dependency's authed nav from the login smoke.
      },
    },
  ],

  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        // NOT `true`. A stale server on :3000 silently invalidates the whole
        // run — a next-server left over from before an upgrade answered `/`
        // with 200 and every other route with 404, which reads exactly like a
        // routing regression. Opt back in explicitly when iterating locally.
        reuseExistingServer: !!process.env.E2E_REUSE_SERVER,
        // Sentry runs in a dedicated e2e environment so verification traffic
        // never eats the production error budget (docs/sentry-budget.md).
        env: { SENTRY_ENVIRONMENT: "e2e", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "e2e" },
        timeout: 180_000,
      },
});
