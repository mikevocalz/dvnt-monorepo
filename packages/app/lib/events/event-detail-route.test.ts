import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { slugify } from "../slug.ts";
import { webEventDetailRoute } from "./event-detail-route.ts";

test("event ID links target the direct-id route, not the title-slug route", () => {
  assert.equal(webEventDetailRoute(42), "/feed/events/42");
  assert.equal(webEventDetailRoute("42"), "/feed/events/42");
  assert.equal(webEventDetailRoute("a/b?c"), "/feed/events/a%2Fb%3Fc");
});

test("Feed and liked-event cards share stable-ID routing", () => {
  const feed = readFileSync(new URL("../../components/event/FeedEventCard.web.tsx", import.meta.url), "utf8");
  const activity = readFileSync(new URL("../../features/activity/activity.web.tsx", import.meta.url), "utf8");
  assert.match(feed, /webEventDetailRoute\(data.id\)/);
  assert.match(activity, /item.entityType === "event"\) return webEventDetailRoute\(item.entityId\)/);
  assert.doesNotMatch(feed, /`\/events\/\$\{/);
  assert.doesNotMatch(activity, /`\/events\/\$\{item.entityId\}/);
});

test("published events also use the direct-id route", () => {
  const create = readFileSync(new URL("../../features/events/event-create.web.tsx", import.meta.url), "utf8");
  assert.match(create, /router.push\(id \? webEventDetailRoute\(id\) : "\/events"\)/);
  assert.doesNotMatch(create, /`\/events\/\$\{id\}`/);
});

test("profile event links share the resolver slugger and preserve private share tokens", () => {
  const profile = readFileSync(new URL("../../features/profile/user-profile.web.tsx", import.meta.url), "utf8");
  assert.match(profile, /ev.visibility === "link_only" && ev.shareSlug[\s\S]*?\? ev.shareSlug[\s\S]*?: slugify\(ev.title\)/);
  assert.doesNotMatch(profile, /function eventSlug/);
  assert.equal(slugify("Café Night"), "cafe-night");
  assert.equal(slugify("Friday’s Party"), "fridays-party");
  assert.equal(slugify(""), "event");
  assert.ok(slugify("a".repeat(80)).length <= 60);
});
