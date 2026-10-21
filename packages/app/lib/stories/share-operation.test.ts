import assert from "node:assert/strict";
import test from "node:test";
import {
  startStoryShareOperation,
  finishStoryShareOperation,
} from "./share-operation.ts";

const STORAGE_KEY = "dvnt:pending-story-shares:v1";
const validId = "12345678-1234-4234-8234-123456789012";

function installStorage(initial = "[]") {
  let value = initial;
  (globalThis as any).window = {
    sessionStorage: {
      getItem: (key: string) => (key === STORAGE_KEY ? value : null),
      setItem: (_key: string, next: string) => {
        value = next;
      },
    },
  };
  return () => JSON.parse(value);
}

test("share retries are single-flight and confirmation clears persisted identity", () => {
  const saved = installStorage();
  const operation = startStoryShareOperation("single-flight")!;
  assert.match(operation.id, /^[0-9a-f-]{36}$/);
  assert.equal(startStoryShareOperation("single-flight"), null);
  finishStoryShareOperation(operation, false);
  assert.equal(startStoryShareOperation("single-flight")!.id, operation.id);
  assert.equal(saved()[0].id, operation.id);
  finishStoryShareOperation(operation, true);
  assert.deepEqual(saved(), []);
  const next = startStoryShareOperation("single-flight")!;
  assert.notEqual(next.id, operation.id);
  finishStoryShareOperation(next, true);
});

test("unresolved browser-session entry survives reload but expired entries do not", () => {
  installStorage(
    JSON.stringify([
      { key: "reload", id: validId, createdAt: Date.now() - 1000 },
    ]),
  );
  const operation = startStoryShareOperation("reload")!;
  assert.equal(operation.id, validId);
  finishStoryShareOperation(operation, true);
  installStorage(
    JSON.stringify([
      {
        key: "expired",
        id: validId,
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
      },
    ]),
  );
  const fresh = startStoryShareOperation("expired")!;
  assert.notEqual(fresh.id, validId);
  finishStoryShareOperation(fresh, true);
});

test("account/source identity is isolated and storage contains only bounded UUID records", () => {
  const saved = installStorage();
  const one = startStoryShareOperation(
    JSON.stringify(["1", "auth1", "post", "11"]),
  )!;
  const two = startStoryShareOperation(
    JSON.stringify(["2", "auth2", "post", "11"]),
  )!;
  assert.notEqual(one.id, two.id);
  finishStoryShareOperation(one, false);
  finishStoryShareOperation(two, false);
  for (let i = 0; i < 110; i++) {
    const operation = startStoryShareOperation(`bounded-${i}`)!;
    finishStoryShareOperation(operation, false);
  }
  assert.equal(saved().length, 100);
  assert.deepEqual(Object.keys(saved()[0]).sort(), ["createdAt", "id", "key"]);
});

test("malformed, future-dated and unavailable storage fall back safely", () => {
  installStorage("not JSON");
  const malformed = startStoryShareOperation("bad-json")!;
  finishStoryShareOperation(malformed, true);
  installStorage(
    JSON.stringify([
      { key: "future", id: validId, createdAt: Date.now() + 100000 },
    ]),
  );
  const future = startStoryShareOperation("future")!;
  assert.notEqual(future.id, validId);
  finishStoryShareOperation(future, true);
  Object.defineProperty((globalThis as any).window, "sessionStorage", {
    get() {
      throw new Error("storage denied");
    },
  });
  const denied = startStoryShareOperation("denied-storage")!;
  finishStoryShareOperation(denied, false);
  assert.equal(startStoryShareOperation("denied-storage")!.id, denied.id);
  finishStoryShareOperation(denied, true);
  delete (globalThis as any).window;
});
