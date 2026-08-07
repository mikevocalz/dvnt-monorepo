import { NextResponse } from "next/server";

/**
 * Apple App Site Association — enables iOS Universal Links. Served at
 * /.well-known/apple-app-site-association as application/json with NO extension
 * (the old Squarespace host couldn't serve this, which is why shared dvntapp.live
 * links never opened the app). The native app already declares
 * `applinks:dvntapp.live` (apps/mobile/app.config.js). appID = TEAMID.BUNDLEID.
 */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: ["436WA3W63V.com.dvnt.app"],
            // Open the app for feed content (posts, profiles, stories…); leave
            // marketing (/) and /auth/* to the web.
            //
            // `/feed` is listed SEPARATELY from `/feed/*`: the wildcard pattern
            // requires the trailing slash, so a bare https://dvntapp.live/feed
            // would not match and would open Safari even with the app
            // installed. The welcome email's CTA points exactly there, so both
            // forms are claimed.
            components: [
              { "/": "/feed", comment: "Feed root (welcome email CTA)" },
              { "/": "/feed/*", comment: "Feed, posts, profiles" },
            ],
          },
        ],
      },
      // webcredentials lets the app autofill passwords saved for the domain.
      webcredentials: { apps: ["436WA3W63V.com.dvnt.app"] },
    },
    { headers: { "content-type": "application/json" } },
  );
}
