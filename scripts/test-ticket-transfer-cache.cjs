// Real TanStack Query cache; no network, auth, or backend writes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const ROOT = path.resolve(__dirname, "..");
const paths = [
  ROOT,
  ...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
];
const dependency = (name) => require(require.resolve(name, { paths }));
const { QueryClient } = dependency("@tanstack/react-query");
const { buildSync } = dependency("esbuild");
const built = buildSync({
  stdin: {
    contents: `export { confirmPendingTransfer } from './packages/app/lib/tickets/transfer-cache';`,
    resolveDir: ROOT,
  },
  tsconfigRaw: { compilerOptions: {} },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  alias: { "@dvnt/app": path.join(ROOT, "packages/app") },
});
const moduleFixture = { exports: {} };
new Function("module", "exports", "require", built.outputFiles[0].text)(
  moduleFixture,
  moduleFixture.exports,
  createRequire(__filename),
);
const { confirmPendingTransfer } = moduleFixture.exports;
const key = (viewer, event) =>
  event ? ["tickets", viewer, "event", event] : ["tickets", viewer, "mine"];

test("confirmed transfer hides selected active credential across owner caches only", async () => {
  const client = new QueryClient();
  const records = [
    { id: "a", status: "active", qr_token: "a-secret" },
    { id: "b", status: "active", qr_token: "b-secret" },
  ];
  for (const k of [key("owner"), key("owner", "event-a"), key("other")])
    client.setQueryData(k, records);
  await confirmPendingTransfer(client, "owner", "a", "event-a");
  for (const k of [key("owner"), key("owner", "event-a")]) {
    assert.equal(client.getQueryData(k)[0].status, "transfer_pending");
    assert.deepEqual(client.getQueryData(k)[1], records[1]);
    assert.equal(client.getQueryState(k).isInvalidated, true);
  }
  assert.equal(client.getQueryData(key("other"))[0].status, "active");
  client.clear();
});
test("older in-flight active response cannot overwrite confirmed pending status", async () => {
  const client = new QueryClient();
  let release;
  client.setQueryData(key("owner"), [{ id: "a", status: "active" }]);
  const old = client
    .fetchQuery({
      queryKey: key("owner"),
      queryFn: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    })
    .catch(() => {});
  await confirmPendingTransfer(client, "owner", "a", "event-a");
  release([{ id: "a", status: "active" }]);
  await old;
  await Promise.resolve();
  assert.equal(client.getQueryData(key("owner"))[0].status, "transfer_pending");
  client.clear();
});
test("late transfer completion does not resurrect void credentials or create absent caches", async () => {
  const client = new QueryClient();
  client.setQueryData(key("owner"), [{ id: "a", status: "void" }]);
  await confirmPendingTransfer(client, "owner", "a", "event-a");
  assert.equal(client.getQueryData(key("owner"))[0].status, "void");
  assert.equal(client.getQueryData(key("owner", "event-a")), undefined);
  client.clear();
});
