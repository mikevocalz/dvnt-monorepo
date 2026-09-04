/**
 * Playwright harness for the DVNT web verification pass (docs/e2e/phase-0.md).
 *
 * Four viewport projects because the Lynk room is the surface under test and
 * P13 WS-5 requires 375/768/1024/1440. WebKit exists for one reason: autoplay
 * policy. Video flyers are progressive MP4 (Bunny Stream is not provisioned),
 * and Safari is the browser that will refuse to autoplay them if `muted` +
 * `playsInline` ever regress — Chromium will happily hide that bug.
 *
 * Media is faked at the browser level so WebRTC specs are deterministic AND
 * assertable: the Y4M/WAV fixtures make tracks non-silent, so an audio-call
 * test can assert RMS > threshold instead of asserting a track merely exists.
 */

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

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
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["camera", "microphone"],
  },

  projects: [
    // Mints the storage state every other project reuses (P13 WS-1).
    { name: "setup", testMatch: /auth\.setup\.ts/ },

    {
      name: "chromium-desktop-1440",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      name: "chromium-tablet-1024",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 768 },
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      name: "chromium-tablet-768",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      name: "chromium-mobile-375",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: false, // Chromium desktop channel; touch emulation is per-spec
        storageState: "e2e/.auth/audit.json",
        launchOptions: { args: fakeMediaArgs },
      },
    },
    {
      // Autoplay/poster cases only — WebKit cannot fake media devices the way
      // Chromium can, so WebRTC specs are excluded from this project by tag.
      name: "webkit-media",
      dependencies: ["setup"],
      grep: /@media/,
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1440, height: 900 },
        storageState: "e2e/.auth/audit.json",
      },
    },
  ],

  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        reuseExistingServer: true,
        // Sentry runs in a dedicated e2e environment so verification traffic
        // never eats the production error budget (docs/sentry-budget.md).
        env: { SENTRY_ENVIRONMENT: "e2e", NEXT_PUBLIC_SENTRY_ENVIRONMENT: "e2e" },
        timeout: 180_000,
      },
});
