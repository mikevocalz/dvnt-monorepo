/**
 * Bootstrap Events Edge Function
 *
 * POST /bootstrap-events
 *
 * Returns all above-the-fold data for the events screen in a single request:
 * - Upcoming events with host info and RSVP attendee avatars
 * - Viewer's RSVP state
 *
 * Eliminates: getEvents + getMyEvents + host lookups + RSVP lookups waterfall.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const t0 = Date.now();

  try {
    const { user_id, limit = 20 } = await req.json();

    if (!user_id) {
      return new Response(JSON.stringify({ error: "user_id required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    // ── 1. Fetch events with valid start_date ─────────────────────────
    const { data: events, error: eventsErr } = await supabase
      .from("events")
      .select("*")
      .not("start_date", "is", null)
      .order("start_date", { ascending: true })
      .limit(limit);

    if (eventsErr) throw eventsErr;

    if (!events || events.length === 0) {
      return new Response(
        JSON.stringify({
          events: [],
          viewerRsvps: {},
          _meta: { elapsed: Date.now() - t0, count: 0 },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── 2. Batch-fetch hosts ──────────────────────────────────────────
    const hostIds = [
      ...new Set(events.map((e: any) => e.host_id).filter(Boolean)),
    ];
    const hostsMap = new Map();

    if (hostIds.length > 0) {
      const { data: hosts } = await supabase
        .from("users")
        .select("id, auth_id, username, avatar_id")
        .in("auth_id", hostIds);

      if (hosts) {
        // Batch-fetch host avatars
        const avatarIds = hosts.map((h: any) => h.avatar_id).filter(Boolean);
        const avatarMap = new Map();
        if (avatarIds.length > 0) {
          const { data: avatars } = await supabase
            .from("media")
            .select("id, url")
            .in("id", avatarIds);
          (avatars || []).forEach((a: any) => avatarMap.set(a.id, a.url));
        }

        hosts.forEach((h: any) => {
          hostsMap.set(h.auth_id, {
            username: h.username,
            avatar: avatarMap.get(h.avatar_id) || "",
          });
        });
      }
    }

    // ── 3. Batch-fetch RSVP attendees with avatars ────────────────────
    const eventIds = events.map((e: any) => e.id);
    const attendeesMap = new Map<
      number,
      { image: string; initials: string }[]
    >();

    const { data: rsvps } = await supabase
      .from("event_rsvps")
      .select("event_id, user_id")
      .in("event_id", eventIds)
      .eq("status", "going");

    if (rsvps && rsvps.length > 0) {
      const rsvpAuthIds = [...new Set(rsvps.map((r: any) => r.user_id))];
      const { data: rsvpUsers } = await supabase
        .from("users")
        .select("auth_id, username, avatar_id")
        .in("auth_id", rsvpAuthIds);

      // Batch avatar lookup
      const rsvpAvatarIds = (rsvpUsers || [])
        .map((u: any) => u.avatar_id)
        .filter(Boolean);
      const rsvpAvatarMap = new Map();
      if (rsvpAvatarIds.length > 0) {
        const { data: avatars } = await supabase
          .from("media")
          .select("id, url")
          .in("id", rsvpAvatarIds);
        (avatars || []).forEach((a: any) => rsvpAvatarMap.set(a.id, a.url));
      }

      const userMap = new Map(
        (rsvpUsers || []).map((u: any) => [
          u.auth_id,
          {
            username: u.username,
            avatarUrl: rsvpAvatarMap.get(u.avatar_id) || "",
          },
        ]),
      );

      for (const rsvp of rsvps) {
        const eid = rsvp.event_id;
        const u = userMap.get(rsvp.user_id);
        const attendee = {
          image: u?.avatarUrl || "",
          initials: u?.username?.slice(0, 2)?.toUpperCase() || "??",
        };
        if (!attendeesMap.has(eid)) attendeesMap.set(eid, []);
        attendeesMap.get(eid)!.push(attendee);
      }
    }

    // ── 4. Get viewer's RSVP state ────────────────────────────────────
    // Resolve integer users.id — user_id from client is Better Auth UUID
    let intUserId: number | null = null;
    const asInt = parseInt(user_id, 10);
    if (!isNaN(asInt) && String(asInt) === String(user_id)) {
      intUserId = asInt;
    } else {
      const { data: userRow } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", user_id)
        .single();
      intUserId = userRow?.id ?? null;
    }

    const viewerRsvps: Record<string, string> = {};
    if (intUserId) {
      const { data: viewerRsvpRows } = await supabase
        .from("event_rsvps")
        .select("event_id, status")
        .eq("user_id", intUserId)
        .in("event_id", eventIds);

      (viewerRsvpRows || []).forEach((r: any) => {
        viewerRsvps[String(r.event_id)] = r.status;
      });
    }

    // ── 5. Format response ────────────────────────────────────────────
    const formattedEvents = events.map((event: any) => {
      const host = hostsMap.get(event.host_id);
      const d = event.start_date ? new Date(event.start_date) : null;
      const rsvpAttendees = attendeesMap.get(event.id) || [];
      const totalCount = Math.max(
        Number(event.total_attendees) || 0,
        rsvpAttendees.length,
      );

      return {
        id: String(event.id),
        title: event.title,
        description: event.description,
        date: d ? d.getDate().toString().padStart(2, "0") : "--",
        month: d
          ? d.toLocaleString("en-US", { month: "short" }).toUpperCase()
          : "---",
        fullDate: d ? d.toISOString() : undefined,
        time: d
          ? d.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
            })
          : "",
        location: event.location,
        image: event.cover_image_url || "",
        images: Array.isArray(event.images) ? event.images : [],
        youtubeVideoUrl: event.youtube_video_url || null,
        price: Number(event.price) || 0,
        likes: 0,
        attendees: rsvpAttendees.length > 0 ? rsvpAttendees : totalCount,
        totalAttendees: totalCount,
        host: {
          username: host?.username || "unknown",
          avatar: host?.avatar || "",
        },
      };
    });

    const elapsed = Date.now() - t0;

    return new Response(
      JSON.stringify({
        events: formattedEvents,
        viewerRsvps,
        _meta: { elapsed, count: formattedEvents.length },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[bootstrap-events] Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
