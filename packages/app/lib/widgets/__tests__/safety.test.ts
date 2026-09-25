/**
 * Content-safety contract for widgets. Verifies that spicy / NSFW / age-gated
 * content NEVER reaches the widget App-Group dataset or a Live Activity — the
 * filtering happens at the write layer (buildWidgetDataset / buildEventLive-
 * ActivityState), not merely hidden in the UI. See docs/widgets-fit.md.
 */
import { buildWidgetDataset, buildEventLiveActivityState } from "../dataset";
import { isWidgetSafe } from "../safety";
import type { BlogSource, SocialSource, TicketSource } from "../types";

const NOW = new Date("2026-01-01T20:00:00Z");
const soon = (mins: number) => new Date(NOW.getTime() + mins * 60_000).toISOString();

describe("isWidgetSafe", () => {
  it("rejects every spicy/NSFW flag spelling", () => {
    expect(isWidgetSafe({ nsfw: true })).toBe(false);
    expect(isWidgetSafe({ isNsfw: true })).toBe(false);
    expect(isWidgetSafe({ isNSFW: true })).toBe(false);
    expect(isWidgetSafe({ is_nsfw: true })).toBe(false);
    expect(isWidgetSafe({ spicy: true })).toBe(false);
  });

  it("rejects non-public visibility even when not NSFW-flagged", () => {
    for (const v of ["spicy", "mature", "age_gated", "private", "followers", "close_friends"]) {
      expect(isWidgetSafe({ visibility: v })).toBe(false);
    }
  });

  it("accepts safe public content", () => {
    expect(isWidgetSafe({ nsfw: false, visibility: "public" })).toBe(true);
    expect(isWidgetSafe({})).toBe(true); // no flags → safe
  });
});

describe("buildWidgetDataset — spicy never reaches the store", () => {
  const safeTicket: TicketSource = {
    ticketId: "t-safe",
    eventId: "e-safe",
    eventName: "Rooftop Social",
    startAt: soon(120),
    tier: "vip",
    nsfw: false,
    visibility: "public",
  };
  const spicyTicket: TicketSource = {
    ticketId: "t-spicy",
    eventId: "e-spicy",
    eventName: "After Dark XXX",
    startAt: soon(60),
    tier: "vip",
    nsfw: true,
  };

  it("drops spicy tickets/blog/social from the dataset entirely", () => {
    const spicyBlog: BlogSource = { slug: "nsfw-post", title: "NSFW", is_nsfw: true };
    const safeBlog: BlogSource = { slug: "ok", title: "OK", visibility: "public" };
    const spicySocial: SocialSource = { id: "s1", title: "spicy like", nsfw: true };
    const safeSocial: SocialSource = { id: "s2", title: "new follower", visibility: "public" };

    const ds = buildWidgetDataset({
      tickets: [safeTicket, spicyTicket],
      blog: [spicyBlog, safeBlog],
      social: [spicySocial, safeSocial],
      unreadCount: 3,
      now: NOW,
    });

    const serialized = JSON.stringify(ds).toLowerCase();
    expect(serialized).not.toContain("xxx");
    expect(serialized).not.toContain("nsfw");
    expect(serialized).not.toContain("t-spicy");

    expect(ds.tickets.map((t) => t.ticketId)).toEqual(["t-safe"]);
    expect(ds.blog.map((b) => b.slug)).toEqual(["ok"]);
    expect(ds.social.map((s) => s.id)).toEqual(["s2"]);
    expect(ds.ticketsSuppressed).toBe(false);
  });

  it("flags ticketsSuppressed (neutral state) when the ONLY ticket is spicy", () => {
    const ds = buildWidgetDataset({ tickets: [spicyTicket], now: NOW });
    expect(ds.tickets).toHaveLength(0);
    expect(ds.ticketsSuppressed).toBe(true); // widget shows neutral branded state
    expect(JSON.stringify(ds).toLowerCase()).not.toContain("after dark");
  });

  it("does not suppress when the user simply has no tickets", () => {
    const ds = buildWidgetDataset({ tickets: [], now: NOW });
    expect(ds.ticketsSuppressed).toBe(false);
  });
});

describe("buildEventLiveActivityState — neutral for spicy", () => {
  it("neutralizes a spicy event's name/venue/art on the Lock Screen", () => {
    const state = buildEventLiveActivityState({
      eventId: "e-spicy",
      ticketId: "t1",
      eventName: "After Dark XXX",
      venueName: "The Vault",
      startAt: soon(30),
      dominantColor: "#ff0000",
      tier: "vip",
      safety: { nsfw: true },
    });
    expect(state.neutral).toBe(true);
    expect(state.eventName).toBe("Your event starts soon");
    expect(state.venueName).toBeNull();
    expect(state.dominantColor).toBeNull();
    expect(state.tier).toBeNull();
    expect(JSON.stringify(state).toLowerCase()).not.toContain("xxx");
  });

  it("keeps full detail for a safe event", () => {
    const state = buildEventLiveActivityState({
      eventId: "e-safe",
      eventName: "Rooftop Social",
      startAt: soon(30),
      venueName: "Sky Bar",
      safety: { nsfw: false, visibility: "public" },
    });
    expect(state.neutral).toBe(false);
    expect(state.eventName).toBe("Rooftop Social");
    expect(state.venueName).toBe("Sky Bar");
  });
});
