/**
 * The "More events" routing rule.
 *
 * Two things broke before and must stay fixed: the link landed on the profile
 * root instead of the host's events, and one link had to stand for every host
 * on a co-hosted event.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hostEventsHref, resolveHosts, needsHostPicker } from "./host-events-route";

test("the link lands on the events tab, not the profile root", () => {
  assert.equal(
    hostEventsHref("nightowl"),
    "/(protected)/profile/nightowl?tab=events",
  );
  assert.equal(hostEventsHref("nightowl", { web: true }), "/profile/nightowl?tab=events");
  // The bug this replaces: a bare profile route shows posts first.
  assert.ok(!hostEventsHref("nightowl").endsWith("/nightowl"));
});

test("usernames that need escaping survive the query string", () => {
  assert.equal(
    hostEventsHref("a b&c"),
    "/(protected)/profile/a%20b%26c?tab=events",
  );
});

test("a lone host is a direct link, never a one-option picker", () => {
  const hosts = resolveHosts({ username: "nightowl", name: "Night Owl" }, []);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].role, "Host");
  assert.equal(needsHostPicker(hosts), false);
});

test("co-hosts turn the same control into a picker, host billed first", () => {
  const hosts = resolveHosts({ username: "nightowl", name: "Night Owl" }, [
    { username: "dusk", name: "Dusk Collective" },
  ]);
  assert.deepEqual(
    hosts.map((h) => [h.username, h.role]),
    [
      ["nightowl", "Host"],
      ["dusk", "Co-host"],
    ],
  );
  assert.equal(needsHostPicker(hosts), true);
});

test("a co-host duplicating the host does not create a fake choice", () => {
  const hosts = resolveHosts({ username: "nightowl" }, [{ username: "nightowl" }]);
  assert.equal(hosts.length, 1);
  assert.equal(needsHostPicker(hosts), false);
});

test("a co-host with no username is dropped rather than rendered blank", () => {
  const hosts = resolveHosts({ username: "nightowl" }, [
    { username: "" },
    { username: "dusk", role: "Presented by" },
  ]);
  assert.deepEqual(
    hosts.map((h) => [h.username, h.role]),
    [
      ["nightowl", "Host"],
      ["dusk", "Presented by"],
    ],
  );
});

test("a missing display name falls back to the handle, never empty", () => {
  const [host] = resolveHosts({ username: "nightowl" }, []);
  assert.equal(host.name, "nightowl");
});
