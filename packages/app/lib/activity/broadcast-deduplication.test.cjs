const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const lib = path.resolve(__dirname, "..");

// Exercise both real notification read paths, with only their external
// persistence, React Query, and Zustand boundaries replaced.
async function readActivities(readPath, docs) {
  const output = {};
  let state;
  const api = {
    getNotifications: async () => ({ docs }),
    formatTimeAgo: () => "now",
  };
  const authStore = select => select({ user: { id: "23" } });
  authStore.getState = () => ({ user: { id: "23" } });
  const historyExports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(lib, "activity/activity-history.ts"), "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports:historyExports});
  const fixtures = {
    "react": {useEffect(){},useReducer:()=>[0,()=>{}],useMemo:fn=>fn()},
    "@dvnt/app/lib/activity/activity-history": historyExports,
    "@dvnt/app/lib/api/notifications": { notificationsApiClient: api },
    "@dvnt/app/lib/stores/auth-store": {
      useAuthStore: authStore,
    },
    "@tanstack/react-query": { useQuery: options => options, useQueryClient:()=>({getQueryData:()=>undefined,setQueryData(){}}) },
    "@dvnt/app/lib/perf/stale-time-config": { STALE_TIMES: {} },
    "@dvnt/app/lib/query-keys": { activityKeys: { list: id => ["activity", id] } },
    "@dvnt/app/lib/api/auth-helper": { getCurrentUserIdSync: () => 23 },
    "@dvnt/app/lib/api/follows": { followsApi: { getFollowing: async () => [] } },
    "@dvnt/app/lib/stores/unread-counts-store": {
      useUnreadCountsStore: { getState: () => ({ setNotificationsUnread() {} }) },
    },
    "zustand": {
      create: init => {
        state = init(
          update => { state = { ...state, ...(typeof update === "function" ? update(state) : update) }; },
          () => state,
        );
        return { getState: () => state };
      },
    },
  };
  const source = fs.readFileSync(path.join(lib, readPath), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: output, console: { log() {}, warn() {}, error() {} },
    require: name => fixtures[name] || {},
  });
  if (readPath.startsWith("hooks/")) {
    return output.useActivitiesQuery().queryFn();
  }
  const store = output.useActivityStore.getState();
  await store.fetchFromBackend();
  return output.useActivityStore.getState().activities;
}

function notification(id, type = "event_broadcast", body = "Venue changed") {
  return {
    id, type, entityType: "event", entityId: "90",
    sender: { id: "613", username: "deviantevents", displayName: "Deviant Events", avatar: "" },
    createdAt: "2026-10-12T03:57:28Z",
    payload: { body },
  };
}

for (const readPath of ["hooks/use-activities-query.ts", "stores/activity-store.ts"]) {
  test(`${readPath}: distinct broadcasts from the same sender and event survive`, async () => {
    const rows = await readActivities(readPath, [
      notification("2", "event_broadcast", "Doors now open at 9"),
      notification("1", "event_broadcast", "Venue changed"),
    ]);
    assert.deepEqual(Array.from(rows, row => row.id), ["2", "1"]);
    assert.deepEqual(Array.from(rows, row => row.payload.body), ["Doors now open at 9", "Venue changed"]);
    assert.ok(rows.every(row => row.user.displayName === "Deviant Events"));
  });
  test(`${readPath}: duplicate broadcast IDs are still removed`, async () => {
    const rows = await readActivities(readPath, [notification("2"), notification("2"), notification("1")]);
    assert.deepEqual(Array.from(rows, row => row.id), ["2", "1"]);
  });
  test(`${readPath}: social composite deduplication is unchanged`, async () => {
    const rows = await readActivities(readPath, [
      notification("4", "like"), notification("3", "like"),
      { ...notification("2", "like"), entityId: "91" },
      notification("1", "follow"),
    ]);
    assert.deepEqual(Array.from(rows, row => row.id), ["4", "2", "1"]);
  });
}
