import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { slugify } from "../slug.ts";
import { matchingEventDetailPreview, resolveEventDetailId, storyEventDetailRoute, webEventDetailRoute } from "./event-detail-route.ts";
import { eventSharePath } from "./event-discovery.ts";

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

const original = { id: 22, title: 'NYC “Freak Show”', status: "active", visibility: "public" };

test("story event destinations use current public titles, not stored snapshots", () => {
  assert.equal(storyEventDetailRoute("22", [original]), "/events/nyc-freak-show");
  assert.equal(storyEventDetailRoute("22", [{ ...original, title: "Renamed Night" }]), "/events/renamed-night");
  assert.equal(storyEventDetailRoute("22"), "/feed/events/22");
  assert.equal(storyEventDetailRoute("22", []), "/feed/events/22");
  assert.equal(storyEventDetailRoute("22", [{ ...original, title: "" }]), "/feed/events/22");
  assert.equal(storyEventDetailRoute("22", [{ ...original, title: "a".repeat(32) }]), "/feed/events/22");
});

test("same normalized titles never redirect a story to a different event", () => {
  const duplicate = { ...original, id: 23, title: "NYC Freak-Show" };
  for (const id of ["22", "23"]) {
    assert.equal(storyEventDetailRoute(id, [original, duplicate]), `/feed/events/${id}`);
  }
  assert.equal(storyEventDetailRoute("22", [original, { ...duplicate, status: "cancelled" }]), "/events/nyc-freak-show");
});

test("private, hidden and unpublished event metadata cannot produce title routes", () => {
  for (const changes of [
    { visibility: "private" }, { visibility: "link_only" }, { status: "cancelled" },
    { status: "draft" }, { is_hidden: true }, { publish_at: "2999-01-01T00:00:00Z" },
  ]) assert.equal(storyEventDetailRoute("22", [{ ...original, ...changes }]), "/feed/events/22");
});

test("title detail resolution ignores stale list entries while pending, failed and resolved", () => {
  const input = { slug: "nyc-freak-show", listEvent: { ...original, id: 23 } };
  assert.equal(resolveEventDetailId(input), undefined);
  assert.equal(resolveEventDetailId({ ...input, index: [] }), undefined);
  assert.equal(resolveEventDetailId({ ...input, index: [original] }), 22);
  assert.equal(matchingEventDetailPreview(input.listEvent, undefined), undefined);
  assert.equal(matchingEventDetailPreview(input.listEvent, 22), undefined);
  assert.equal(matchingEventDetailPreview(original, "22"), original);
});

test("direct-ID ownership, token access and public sharing keep their existing lanes", () => {
  const slug = "a".repeat(32);
  assert.equal(resolveEventDetailId({ directId: 7, slug, tokenId: 8, index: [original] }), 7);
  assert.equal(resolveEventDetailId({ slug, tokenId: 8, listEvent: original }), 8);
  assert.equal(resolveEventDetailId({ slug, listEvent: original }), 22);
  assert.equal(resolveEventDetailId({ slug, index: [{ ...original, title: slug }] }), undefined);
  assert.equal(eventSharePath({ id: 22, visibility: "public" }), "/e/22");
  assert.equal(eventSharePath({ id: 22, visibility: "link_only", shareSlug: slug }), `/events/${slug}`);
});
