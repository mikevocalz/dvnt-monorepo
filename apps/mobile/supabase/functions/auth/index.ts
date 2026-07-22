/**
 * Edge Function: auth
 *
 * Better Auth handler — the ONLY auth server for the DVNT app.
 * Handles: sign-in, sign-up, sign-out, session, reset-password, verify-email.
 *
 * Required Deno env vars (set via `supabase secrets set`):
 *   DATABASE_URL          — Supabase Postgres connection string
 *   BETTER_AUTH_SECRET    — Secret for signing sessions/tokens
 *   RESEND_API_KEY        — Resend API token (re_...)
 *   RESEND_FROM_EMAIL     — Verified sender (e.g. DVNT <noreply@dvntapp.live>)
 *   APPLE_CLIENT_ID       — Apple Services ID (e.g. com.dvnt.app)
 *   APPLE_CLIENT_SECRET   — Apple JWT client secret
 */

import {
  welcome as welcomeEmail,
  resetPassword as resetPasswordEmail,
  verifyEmailLink,
  accountLinked as accountLinkedEmail,
  magicLinkEmail,
} from "../_shared/email/templates.ts";
import { brandEmailWrapper } from "../_shared/email/wrapper.ts";

// ─── Env ────────────────────────────────────────────────────────────────────
const DATABASE_URL = Deno.env.get("DATABASE_URL") || "";
const BETTER_AUTH_SECRET = Deno.env.get("BETTER_AUTH_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM_EMAIL =
  Deno.env.get("RESEND_FROM_EMAIL") || "DVNT <noreply@dvntapp.live>";
const DARK_EMAIL_MARKER = 'name="color-scheme" content="dark"';
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const AUTH_BASE_URL = SUPABASE_URL; // Origin only — basePath stripping below depends on this
// The reachable URL Apple/Google must redirect to. We can't just rely on
// {AUTH_BASE_URL}{basePath}/callback/apple because that produces
// /api/auth/callback/apple which 404s at the Supabase gateway. The
// edge function is actually mounted at /functions/v1/auth, so we
// explicitly tell each OAuth provider where to send the user back.
// (App Store review caught this on 2026-06-02 — Sign in with Apple
// completed at Apple but never made it back to Better Auth.)
const OAUTH_CALLBACK_BASE = `${SUPABASE_URL}/functions/v1/auth/api/auth/callback`;
const APPLE_CLIENT_ID = Deno.env.get("APPLE_CLIENT_ID") || "";
const APPLE_CLIENT_SECRET = Deno.env.get("APPLE_CLIENT_SECRET") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

// Append the Supabase anon key as a query param so browser-initiated
// GETs (reset-password, verify-email links from email) pass the gateway
// which otherwise rejects requests with no Authorization header.
//
// As of the AUTH_BASE_URL fix above, Better Auth now emits URLs already
// prefixed with /functions/v1/auth, so the legacy /api/auth/ → /functions/v1/auth/api/auth/
// rewrite is mostly a no-op. Kept for safety against any cached link
// in flight that was generated before the deploy.
function fixEmailUrl(url: string): string {
  const fixed =
    url.includes("/functions/v1/auth/api/auth/")
      ? url // already correct (post AUTH_BASE_URL fix)
      : url.replace(
          `${SUPABASE_URL}/api/auth/`,
          `${SUPABASE_URL}/functions/v1/auth/api/auth/`,
        );
  const sep = fixed.includes("?") ? "&" : "?";
  return SUPABASE_ANON_KEY
    ? `${fixed}${sep}apikey=${SUPABASE_ANON_KEY}`
    : fixed;
}

/**
 * For WEB recovery/verification, point the email link at the requesting app
 * origin's OWN page with the token in the query — a first-party, TOKEN-BASED
 * link. The page completes the action with the token directly, so it never
 * depends on a session cookie (which Better Auth would have set on the Supabase
 * domain, not the app domain — the cause of web "This link is no longer valid").
 *
 * Returns null for native requests (callbackURL is a `dvnt://` deep link, not
 * https) so those keep the existing `fixEmailUrl` behavior untouched.
 */
function webFirstPartyEmailLink(url: string): string | null {
  try {
    const u = new URL(url);
    const callbackURL = u.searchParams.get("callbackURL");
    if (!callbackURL || !/^https?:\/\//i.test(callbackURL)) return null;
    const token =
      u.searchParams.get("token") ||
      u.pathname.match(/\/(?:reset-password|verify-email)\/([^/?]+)/)?.[1] ||
      null;
    if (!token) return null;
    const sep = callbackURL.includes("?") ? "&" : "?";
    return `${callbackURL}${sep}token=${encodeURIComponent(token)}`;
  } catch {
    return null;
  }
}
console.log("[Auth] Starting edge function...");
console.log("[Auth] DATABASE_URL:", DATABASE_URL ? "SET" : "MISSING");
console.log(
  "[Auth] BETTER_AUTH_SECRET:",
  BETTER_AUTH_SECRET ? "SET" : "MISSING",
);
console.log("[Auth] AUTH_BASE_URL:", AUTH_BASE_URL);

// ─── CORS ───────────────────────────────────────────────────────────────────
// The web client uses `credentials: include`, and browsers REJECT a wildcard
// `Access-Control-Allow-Origin: *` on credentialed requests — the origin must be
// reflected. Native clients send no Origin header, so the wildcard fallback is
// harmless for them. (This was the cause of web "Failed to fetch" on login.)
const CORS_BASE: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, cookie, set-cookie",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Expose-Headers": "set-auth-token, set-cookie",
};
function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return origin
    ? { ...CORS_BASE, "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : { ...CORS_BASE, "Access-Control-Allow-Origin": "*" };
}

// ─── Email helpers ──────────────────────────────────────────────────────────
// The branded HTML now comes from the shared kit (../_shared/email). This file
// keeps only the low-level Resend send (its fire-and-forget logging behavior),
// and composes the new landing-grade templates for reset / verify / welcome.

function ensureDarkEmail(html: string): string {
  return html.includes(DARK_EMAIL_MARKER)
    ? html
    : brandEmailWrapper(html, { preheader: "" });
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error("[Auth:Email] RESEND_API_KEY not set, skipping email");
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to,
        subject,
        html: ensureDarkEmail(html),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[Auth:Email] Resend error ${res.status}:`, data);
    } else {
      console.log(
        `[Auth:Email] ✓ Sent "${subject}" to ${to}, id: ${data?.id || "unknown"}`,
      );
    }
  } catch (err) {
    console.error(`[Auth:Email] ✗ Failed "${subject}" to ${to}:`, err);
  }
}

// ─── Lazy-load Better Auth (deferred so startup doesn't crash) ──────────────
let _auth: any = null;
let _initError: string | null = null;

async function getAuth() {
  if (_auth) return _auth;
  if (_initError) throw new Error(_initError);

  try {
    console.log("[Auth] Initializing Better Auth...");

    // Import Better Auth + plugins
    const { betterAuth } = await import("npm:better-auth@1.5.5");
    const { expo } = await import("npm:@better-auth/expo@1.5.5");
    const { username, magicLink } = await import("npm:better-auth@1.5.5/plugins");
    // Import npm:pg — Deno supports Node built-ins (node:net, node:tls) needed by pg
    const pgModule = await import("npm:pg@8.13.1");
    const Pool = pgModule.Pool || pgModule.default?.Pool || pgModule.default;
    console.log("[Auth] All modules loaded, Pool type:", typeof Pool);

    // Use SUPABASE_DB_URL (internal connection, supports TCP from within Supabase infra)
    // Falls back to DATABASE_URL (external pooler connection)
    const dbUrl = Deno.env.get("SUPABASE_DB_URL") || DATABASE_URL;
    console.log("[Auth] DB URL length:", dbUrl.length);

    // Create a real pg.Pool instance — Better Auth recognizes this via instanceof
    const pool = new Pool({
      connectionString: dbUrl,
      max: 2,
      ssl: dbUrl.includes("sslmode=")
        ? undefined
        : { rejectUnauthorized: false },
    });

    // Test the connection immediately
    const testClient = await pool.connect();
    const testResult = await testClient.query("SELECT 1 as ok");
    testClient.release();
    console.log("[Auth] DB connection verified:", testResult.rows[0]);

    _auth = betterAuth({
      database: pool,
      secret: BETTER_AUTH_SECRET,
      baseURL: AUTH_BASE_URL, // Just origin, no path — basePath controls route prefix
      basePath: "/api/auth",
      trustedOrigins: [
        "dvnt://",
        "dvnt://*",
        "exp+dvnt://",
        "exp+dvnt://*",
        "exp://",
        "http://localhost:8081",
        // Web clients (Better Auth's CSRF gate rejects untrusted origins with a
        // 403 "Invalid origin" BEFORE checking credentials). The web app proxies
        // /api/auth/* through Next, so the browser's Origin header is the Vercel
        // page origin — it MUST be trusted here or every browser login 403s.
        // Cross-site CSRF risk is independently mitigated by the session cookie's
        // SameSite=Lax attribute (cross-site POSTs don't carry the cookie).
        "http://localhost:5173", // apps/web-vite dev
        "http://localhost:3000", // apps/web (Next) dev
        // Production web origins:
        "https://dvnt-blog.vercel.app", // Vercel default domain
        "https://blog.dvntapp.live", // custom blog domain
        "https://dvntapp.live",
        "https://www.dvntapp.live",
        // Vercel preview deploys (random per-commit subdomains under the team):
        "https://*.vercel.app",
        // Any additional origins from env (comma-separated), for future domains
        // without a code change:
        ...(Deno.env.get("WEB_TRUSTED_ORIGINS") || "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean),
        AUTH_BASE_URL,
      ],
      plugins: [
        expo(),
        username(),
        // B4: BetterAuth mints/expires/verifies the link token; Resend only
        // delivers. sendMagicLink signature verified against
        // better-auth@1.5.5/dist/plugins/magic-link/index.d.mts:35.
        magicLink({
          expiresIn: 60 * 15,
          sendMagicLink: async ({ email, url }: { email: string; url: string }) => {
            // Better Auth emits {SUPABASE_ORIGIN}/api/auth/magic-link/verify.
            // For web sign-ins the verify hop must run through the dvntapp.live
            // /api/auth proxy so the session cookie lands FIRST-party (same
            // constraint as the Google callback). App-scheme callbacks keep the
            // original host — the Expo plugin handles the deep link.
            let sendUrl = url;
            try {
              const u = new URL(url);
              const cb = u.searchParams.get("callbackURL") || "";
              if (/^https?:\/\/(www\.)?dvntapp\.live/i.test(cb)) {
                sendUrl = `https://dvntapp.live${u.pathname.replace(/^.*(\/api\/auth\/)/, "/api/auth/")}${u.search}`;
              }
            } catch { /* send the original URL */ }
            const { subject, html } = magicLinkEmail(sendUrl);
            await sendEmail(email, subject, html);
          },
        }),
      ],
      socialProviders: {
        ...(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: GOOGLE_CLIENT_ID,
                clientSecret: GOOGLE_CLIENT_SECRET,
                // Web-first: the callback must land on the WEB origin (proxied
                // to this fn by Next's /api/auth rewrite) so the session cookie
                // is first-party on dvntapp.live. A supabase.co callback (like
                // Apple's native flow) would set cookies the browser never
                // sends back to the app. Must match the URI registered in the
                // Google Cloud OAuth client.
                redirectURI:
                  Deno.env.get("GOOGLE_REDIRECT_URI") ||
                  "https://dvntapp.live/api/auth/callback/google",
              },
            }
          : {}),
        ...(APPLE_CLIENT_ID && APPLE_CLIENT_SECRET
          ? {
              apple: {
                clientId: APPLE_CLIENT_ID,
                clientSecret: APPLE_CLIENT_SECRET,
                // Native iOS Sign in with Apple sends an identityToken whose
                // `aud` claim is the iOS app's bundle identifier, not the
                // web Services ID. Better Auth needs both audiences to be
                // accepted so signIn.social({ idToken }) works from native.
                appBundleIdentifier: "com.dvnt.app",
                // Explicit redirect URI — must reach the actual mounted
                // edge function (/functions/v1/auth/...). Without this,
                // Better Auth would emit /api/auth/callback/apple which
                // 404s at the Supabase gateway and the whole OAuth flow
                // fails silently.
                redirectURI: `${OAUTH_CALLBACK_BASE}/apple`,
              },
            }
          : {}),
      },
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
        requireEmailVerification: false,
        sendResetPassword: async ({
          user,
          url,
        }: {
          user: any;
          url: string;
        }) => {
          console.log(`[Auth] Password reset requested for ${user.email}`);
          console.log(`[Auth] Original reset URL: ${url}`);
          // Web → first-party token link (cookie-independent); native → legacy.
          const resetUrl = webFirstPartyEmailLink(url) ?? fixEmailUrl(url);
          console.log(`[Auth] Fixed reset URL: ${resetUrl}`);
          const { subject, html } = resetPasswordEmail(resetUrl);
          await sendEmail(user.email, subject, html);
        },
        sendVerificationEmail: async ({
          user,
          url,
        }: {
          user: any;
          url: string;
        }) => {
          console.log(`[Auth] Email verification requested for ${user.email}`);
          // Web → first-party token link (cookie-independent); native → legacy.
          const verifyUrl = webFirstPartyEmailLink(url) ?? fixEmailUrl(url);
          const name = user.name || user.email.split("@")[0];
          const { subject, html } = verifyEmailLink(verifyUrl, name);
          await sendEmail(user.email, subject, html);
        },
      },
      databaseHooks: {
        user: {
          create: {
            // BETA GATE. Runs before the user row is created for EVERY signup
            // method (email/password AND OAuth). Rejects emails not on the
            // allowlist so the auth record is never minted (hard, server-side
            // gate). Matching is case-insensitive + whitespace-trimmed via the
            // is_allowlisted SQL fn. Fail-closed: a lookup error blocks the
            // signup rather than letting a non-allowlisted email through.
            before: async (user: any) => {
              const email = String(user?.email ?? "").trim().toLowerCase();
              const { rows } = await pool.query(
                "select public.is_allowlisted($1) as ok",
                [email],
              );
              if (!rows?.[0]?.ok) {
                const { APIError } = await import("npm:better-auth@1.5.5/api");
                console.log(`[Auth] Beta gate: rejected ${email}`);
                throw new APIError("FORBIDDEN", {
                  code: "BETA_ONLY",
                  message: "Beta Users Access Only",
                });
              }
              return { data: user };
            },
            // CANONICAL welcome trigger. Fires server-side for EVERY signup
            // method (email/password AND Apple/Google OAuth), so it's the one
            // place welcome is sent. The legacy POST /auth/send-welcome endpoint
            // (still called by SignUpStep2) is neutered to a no-op to avoid a
            // duplicate welcome — see that handler below.
            after: async (user: any) => {
              console.log(
                `[Auth] New user created: ${user.email}, sending welcome email`,
              );
              const name = user.name || user.email.split("@")[0];
              const { subject, html } = welcomeEmail(name);
              await sendEmail(user.email, subject, html);
            },
          },
        },
        account: {
          create: {
            // MERGE NOTICE. Fires whenever a provider account row is created.
            // If a SOCIAL account (google/apple) lands on a user who already
            // has another sign-in method, account linking just merged them —
            // tell the person by email. Fresh social signups (no prior
            // account rows) get the welcome email above instead, not this.
            // Best-effort: an email failure must never block the sign-in.
            after: async (account: any) => {
              try {
                const provider = String(account?.providerId ?? "");
                if (provider === "credential") return;
                const { rows: others } = await pool.query(
                  'select "providerId" from "account" where "userId" = $1 and "id" <> $2 limit 1',
                  [account.userId, account.id],
                );
                if (!others?.length) return; // brand-new social signup
                const { rows: users } = await pool.query(
                  'select "name", "email" from "user" where "id" = $1',
                  [account.userId],
                );
                const u = users?.[0];
                if (!u?.email) return;
                const providerLabel =
                  provider.charAt(0).toUpperCase() + provider.slice(1);
                const name = u.name || String(u.email).split("@")[0];
                console.log(
                  `[Auth] ${providerLabel} account merged into existing user ${u.email} — sending notice`,
                );
                const { subject, html } = accountLinkedEmail(name, {
                  provider: providerLabel,
                  email: u.email,
                });
                await sendEmail(u.email, subject, html);
              } catch (err) {
                console.error("[Auth] account-linked email failed:", err);
              }
            },
          },
        },
      },
      user: {
        additionalFields: {
          username: { type: "string", required: false, input: true },
        },
      },
      session: {
        expiresIn: 60 * 60 * 24 * 30,
        updateAge: 60 * 60 * 24,
      },
      account: {
        accountLinking: {
          enabled: true,
          trustedProviders: ["google", "apple"],
        },
      },
    });

    console.log("[Auth] Better Auth initialized successfully");
    return _auth;
  } catch (err: any) {
    _initError = err.message || "Unknown init error";
    console.error("[Auth] INIT FAILED:", err);
    throw err;
  }
}

// ─── Deno.serve handler ─────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsFor(req) });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  // Health check (lightweight, no DB init)
  if (path === "/auth" || path === "/auth/health") {
    return new Response(
      JSON.stringify({
        ok: true,
        service: "dvnt-auth",
        initialized: !!_auth,
        initError: _initError,
        database: DATABASE_URL ? "configured" : "MISSING",
        secret: BETTER_AUTH_SECRET ? "configured" : "MISSING",
        resend: RESEND_API_KEY ? "configured" : "MISSING",
        baseUrl: AUTH_BASE_URL,
      }),
      {
        status: 200,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      },
    );
  }

  // Welcome email endpoint — NEUTERED (no-op).
  //
  // Welcome is now sent exactly once by the canonical databaseHooks.user.create
  // .after hook (covers every signup method server-side). This endpoint used to
  // ALSO send an identical welcome, so email/password signups (whose client
  // SignUpStep2 POSTs here) received TWO welcomes. We keep the route returning
  // 200 so older app builds that still call it don't error or retry — but it no
  // longer sends. The client call has also been removed in SignUpStep2; this is
  // the belt-and-suspenders guard for shipped clients.
  if (path === "/auth/send-welcome" && req.method === "POST") {
    console.log(
      "[Auth] /send-welcome called but is a no-op (welcome owned by user.create hook)",
    );
    return new Response(
      JSON.stringify({ ok: true, skipped: "welcome owned by user.create hook" }),
      {
        status: 200,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      },
    );
  }

  // All other requests → Better Auth
  try {
    const auth = await getAuth();

    // URL rewriting: Supabase sends http://domain/auth/api/auth/sign-in/email
    // Strip /auth prefix → /api/auth/sign-in/email
    // Construct https://domain/api/auth/sign-in/email (matching basePath)
    const strippedPath = path.replace(/^\/auth/, "") || "/";
    const rewrittenUrl = `${AUTH_BASE_URL}${strippedPath}${url.search}`;

    console.log("[Auth]", req.method, path, "→", strippedPath);

    const authRequest = new Request(rewrittenUrl, {
      method: req.method,
      headers: req.headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : null,
    });

    const response = await auth.handler(authRequest);

    // Merge CORS headers into response
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsFor(req))) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    console.error("[Auth] Handler error:", error);
    return new Response(
      JSON.stringify({
        error: "Auth service error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsFor(req), "Content-Type": "application/json" },
      },
    );
  }
});
