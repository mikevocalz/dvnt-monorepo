/**
 * Share Page — Web Fallback for Universal Links
 *
 * GET /share-page?type=event&id=123
 *
 * Returns an HTML page with:
 * - Open Graph meta tags (rich previews in iMessage, WhatsApp, etc.)
 * - Event details summary
 * - "Open in DVNT" deep link button
 * - App Store fallback link
 *
 * This function is invoked when a user without the app clicks a shared link.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const APP_STORE_URL = "https://apps.apple.com/app/id6758054072";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.dvnt.app";
const APP_SCHEME = "dvnt";
const WEB_DOMAIN = "https://dvntapp.live";
const CDN_URL = Deno.env.get("BUNNY_CDN_URL") || "https://dvnt.b-cdn.net";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "event";
  const id = url.searchParams.get("id") || "";

  if (!id) {
    return redirectToHome();
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });

  try {
    if (type === "event") {
      return await renderEventPage(supabase, id);
    } else if (type === "profile") {
      return await renderProfilePage(supabase, id);
    } else {
      return redirectToHome();
    }
  } catch (err: any) {
    console.error("[share-page] Error:", err);
    return redirectToHome();
  }
});

// ── Event Page ────────────────────────────────────────────────────────

async function renderEventPage(supabase: any, eventId: string) {
  const { data: event } = await supabase
    .from("events")
    .select(
      "id, title, description, location, date, end_date, image_url, price, max_attendees, visibility",
    )
    .eq("id", parseInt(eventId))
    .single();

  // No existence leak: this runs as service_role (bypasses RLS), so gate
  // visibility here. PRIVATE events render nothing — same response as a
  // nonexistent event (Phase 5.6.8). link_only is fine (you have the link).
  if (!event || !["public", "link_only"].includes(event.visibility)) {
    return redirectToHome();
  }

  const title = event.title || "Event on DVNT";
  const description = truncate(
    event.description || "Check out this event on DVNT",
    160,
  );
  const image = event.image_url
    ? event.image_url.startsWith("http")
      ? event.image_url
      : `${CDN_URL}/${event.image_url}`
    : `${WEB_DOMAIN}/event-company-logo-music.jpg`;
  const location = event.location || "TBA";
  const date = formatDate(event.date);
  const price = event.price ? `$${(event.price / 100).toFixed(0)}` : "Free";
  const deepLink = `${APP_SCHEME}://e/${eventId}`;

  const html = renderHTML({
    title: `${title} — DVNT`,
    ogTitle: title,
    ogDescription: `${date} · ${location} · ${price}`,
    ogImage: image,
    ogUrl: `${WEB_DOMAIN}/e/${eventId}`,
    ogType: "website",
    body: `
      <div class="card">
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" class="hero" />` : ""}
        <div class="content">
          <h1>${escapeHtml(title)}</h1>
          <div class="meta">
            <span>📅 ${escapeHtml(date)}</span>
            <span>📍 ${escapeHtml(location)}</span>
            <span>🎟️ ${escapeHtml(price)}</span>
          </div>
          ${description ? `<p class="desc">${escapeHtml(description)}</p>` : ""}
          <a href="${deepLink}" class="btn primary">Open in DVNT</a>
          <div class="stores">
            <a href="${APP_STORE_URL}" class="btn secondary">App Store</a>
            <a href="${PLAY_STORE_URL}" class="btn secondary">Google Play</a>
          </div>
        </div>
      </div>
    `,
    deepLink,
  });

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
  });
}

// ── Profile Page ──────────────────────────────────────────────────────

async function renderProfilePage(supabase: any, username: string) {
  const { data: user } = await supabase
    .from("users")
    .select(
      "id, username, first_name, last_name, bio, avatar, followers_count, posts_count",
    )
    .eq("username", username)
    .single();

  if (!user) {
    return redirectToHome();
  }

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username;
  const bio = truncate(user.bio || "", 160);
  const avatar = user.avatar
    ? user.avatar.startsWith("http")
      ? user.avatar
      : `${CDN_URL}/${user.avatar}`
    : `${WEB_DOMAIN}/ai-avatar.jpg`;
  const deepLink = `${APP_SCHEME}://u/${username}`;

  const html = renderHTML({
    title: `${displayName} (@${user.username}) — DVNT`,
    ogTitle: `${displayName} (@${user.username})`,
    ogDescription: bio || `Follow @${user.username} on DVNT`,
    ogImage: avatar,
    ogUrl: `${WEB_DOMAIN}/u/${username}`,
    ogType: "profile",
    body: `
      <div class="card">
        <div class="content profile">
          ${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(displayName)}" class="avatar" />` : ""}
          <h1>${escapeHtml(displayName)}</h1>
          <p class="username">@${escapeHtml(user.username)}</p>
          ${bio ? `<p class="desc">${escapeHtml(bio)}</p>` : ""}
          <a href="${deepLink}" class="btn primary">Open in DVNT</a>
          <div class="stores">
            <a href="${APP_STORE_URL}" class="btn secondary">App Store</a>
            <a href="${PLAY_STORE_URL}" class="btn secondary">Google Play</a>
          </div>
        </div>
      </div>
    `,
    deepLink,
  });

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...CORS_HEADERS },
  });
}

// ── HTML Template ─────────────────────────────────────────────────────

interface PageData {
  title: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  ogUrl: string;
  ogType: string;
  body: string;
  deepLink: string;
}

function renderHTML(data: PageData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(data.title)}</title>

  <!-- Open Graph -->
  <meta property="og:title" content="${escapeHtml(data.ogTitle)}" />
  <meta property="og:description" content="${escapeHtml(data.ogDescription)}" />
  <meta property="og:image" content="${escapeHtml(data.ogImage)}" />
  <meta property="og:url" content="${escapeHtml(data.ogUrl)}" />
  <meta property="og:type" content="${data.ogType}" />
  <meta property="og:site_name" content="DVNT" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(data.ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(data.ogDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(data.ogImage)}" />

  <!-- Deep link redirect (tries app first) -->
  <meta http-equiv="refresh" content="2;url=${escapeHtml(data.deepLink)}" />

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', system-ui, sans-serif;
      background: #000;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #111;
      border-radius: 24px;
      overflow: hidden;
      max-width: 420px;
      width: 100%;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .hero {
      width: 100%;
      height: 240px;
      object-fit: cover;
    }
    .content {
      padding: 24px;
    }
    .content.profile {
      text-align: center;
    }
    .avatar {
      width: 88px;
      height: 88px;
      border-radius: 50%;
      object-fit: cover;
      margin: 0 auto 16px;
      display: block;
      border: 3px solid rgba(255,255,255,0.1);
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .username {
      color: rgba(255,255,255,0.5);
      font-size: 15px;
      margin-bottom: 12px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 16px;
      font-size: 14px;
      color: rgba(255,255,255,0.7);
    }
    .desc {
      color: rgba(255,255,255,0.6);
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 20px;
    }
    .btn {
      display: block;
      text-align: center;
      padding: 14px 24px;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn.primary {
      background: #8A40CF;
      color: #fff;
      margin-bottom: 12px;
    }
    .stores {
      display: flex;
      gap: 8px;
    }
    .btn.secondary {
      flex: 1;
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.7);
      border: 1px solid rgba(255,255,255,0.1);
      font-size: 14px;
      padding: 12px;
    }
    .footer {
      text-align: center;
      padding: 16px;
      font-size: 12px;
      color: rgba(255,255,255,0.3);
    }
  </style>
</head>
<body>
  ${data.body}
  <script>
    // Try opening deep link immediately
    window.location.href = "${data.deepLink}";
  </script>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────

function redirectToHome() {
  return new Response(null, {
    status: 302,
    headers: { Location: APP_STORE_URL, ...CORS_HEADERS },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "TBA";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}
