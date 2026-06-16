import { NextResponse } from "next/server";

/**
 * Android App Links (Digital Asset Links) — served at /.well-known/assetlinks.json.
 * Lets dvntapp.live links open the native app (package com.dvnt.app) and
 * auto-verify. The SHA-256 fingerprint(s) MUST match the app's release signing
 * key — get them from `eas credentials` (Android) or the Play Console
 * (Setup → App integrity → App signing) and paste below. Until then Android
 * App Link auto-verification will not pass.
 */
export const dynamic = "force-static";

const SHA256_FINGERPRINTS: string[] = [
  // TODO: replace with the real release-key SHA-256 fingerprint(s), e.g.
  // "AA:BB:CC:...:FF"
  "REPLACE_WITH_RELEASE_SHA256_FINGERPRINT",
];

export function GET() {
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.dvnt.app",
          sha256_cert_fingerprints: SHA256_FINGERPRINTS,
        },
      },
    ],
    { headers: { "content-type": "application/json" } },
  );
}
