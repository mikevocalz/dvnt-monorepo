const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function loadModule(file, requireModule, globals = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: requireModule, ...globals });
  return module.exports;
}

function fixture(initial, options = {}) {
  let settings = initial;
  let handler;
  let writes = 0;
  let readCount = 0;
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const database = {
    from(table) {
      if (table === "users") {
        const q = { select: () => q, eq: (key, value) => { assert.equal(key,"auth_id"); assert.equal(value,"verified-viewer"); return q; },
          maybeSingle: async () => options.profileError ? {data:null,error:{code:"08006"}} : {data:{is_private:options.privateProfile === true},error:null} };
        return q;
      }
      assert.equal(table, "user_settings");
      let operation = "read";
      let next;
      const filters = {};
      const execute = async () => {
        assert.equal(filters.auth_id ?? next?.auth_id, "verified-viewer");
        if (operation === "read") {
          readCount++;
          if (options.readError) return { data: null, error: { code: "08006" } };
          return settings === undefined
            ? { data: null, error: { code: "PGRST116" } }
            : { data: { settings: clone(settings) }, error: null };
        }
        writes++;
        if (options.beforeWrite) {
          settings = options.beforeWrite(settings, writes);
        }
        if (options.writeError) return { data: null, error: { code: "08006" } };
        if (operation === "insert" && settings !== undefined) {
          return { data: null, error: { code: "23505" } };
        }
        if (operation === "update" && filters.settings !== JSON.stringify(settings)) {
          return { data: null, error: null };
        }
        settings = clone(next.settings);
        return { data: { settings: clone(settings) }, error: null };
      };
      const query = {
        select: () => query,
        eq: (key, value) => { filters[key] = value; return query; },
        is: (key, value) => { filters[key] = JSON.stringify(value); return query; },
        update: value => { operation = "update"; next = value; return query; },
        insert: value => { operation = "insert"; next = value; return query; },
        single: execute,
        maybeSingle: execute,
      };
      return query;
    },
  };
  const merge = loadModule(__dirname + "/merge-settings.ts", () => { throw Error("Unexpected import"); });
  loadModule(__dirname + "/index.ts", name => {
    if (name.includes("supabase-js")) return { createClient: () => database };
    if (name.includes("verify-session")) return { verifySessionDetailed: async () => ({ ok: true, userId: "verified-viewer" }) };
    if (name === "./merge-settings.ts") return merge;
    throw Error("Unexpected import " + name);
  }, {
    Response,
    console: { error() {}, log() {} },
    Deno: { env: { get: () => "fixture" }, serve: callback => { handler = callback; } },
  });
  return {
    get settings() { return settings; },
    get writes() { return writes; },
    get readCount() { return readCount; },
    async update(patch) {
      return (await handler(new Request("https://fixture.invalid", {
        method: "POST", headers: { Authorization: "Bearer fixture" },
        body: JSON.stringify({ action: "update", settings: patch, auth_id: "attacker" }),
      }))).json();
    },
    async get() {
      return (await handler(new Request("https://fixture.invalid", {
        method:"POST",headers:{Authorization:"Bearer fixture"},body:JSON.stringify({action:"get"}),
      }))).json();
    },
  };
}

test("toggling a sibling retains Private Account and unrelated preferences", async () => {
  const h = fixture({ privacy: { privateAccount: true, activityStatus: true }, notifications: { likes: false } });
  assert.equal((await h.update({ privacy: { activityStatus: false } })).ok, true);
  assert.deepEqual(h.settings, { privacy: { privateAccount: true, activityStatus: false }, notifications: { likes: false } });
  await h.update({ privacy: { readReceipts: false } });
  assert.equal(h.settings.privacy.privateAccount, true);
});

test("explicitly choosing public still updates the Private Account preference", async () => {
  const h = fixture({ privacy: { privateAccount: true, activityStatus: false } });
  await h.update({ privacy: { privateAccount: false } });
  assert.deepEqual(h.settings.privacy, { privateAccount: false, activityStatus: false });
});

test("read failures cannot overwrite saved preferences", async () => {
  const h = fixture({ privacy: { privateAccount: true } }, { readError: true });
  assert.equal((await h.update({ privacy: { readReceipts: false } })).ok, false);
  assert.equal(h.writes, 0);
});

test("arrays are not valid settings patches", async () => {
  const h = fixture({ privacy: { privateAccount: true } });
  assert.equal((await h.update([])).error.code, "validation_error");
  assert.equal(h.writes, 0);
});

test("new members receive their first preference without an upsert overwrite", async () => {
  const h = fixture(undefined);
  assert.equal((await h.update({ privacy: { privateAccount: true } })).ok, true);
  assert.equal(h.settings.privacy.privateAccount, true);
});

test("concurrent sibling update is reread and preserved", async () => {
  const h = fixture({ privacy: { privateAccount: false } }, {
    beforeWrite: (settings, attempt) => attempt === 1 ? { privacy: { privateAccount: true } } : settings,
  });
  assert.equal((await h.update({ privacy: { readReceipts: false } })).ok, true);
  assert.deepEqual(h.settings.privacy, { privateAccount: true, readReceipts: false });
  assert.equal(h.writes, 2);
});

test("concurrent first-write race cannot reset another saved preference", async () => {
  const h = fixture(undefined, {
    beforeWrite: (settings, attempt) => attempt === 1 ? { privacy: { privateAccount: true } } : settings,
  });
  assert.equal((await h.update({ privacy: { readReceipts: false } })).ok, true);
  assert.deepEqual(h.settings.privacy, { privateAccount: true, readReceipts: false });
});

test("repeated conflicts fail visibly instead of claiming success or retrying forever", async () => {
  const h = fixture({ version: 0 }, { beforeWrite: (_settings, attempt) => ({ version: attempt }) });
  assert.equal((await h.update({ privacy: { privateAccount: true } })).error.code, "conflict");
  assert.equal(h.writes, 4);
  assert.deepEqual(h.settings, { version: 4 });
});

test("write failures leave original preferences intact", async () => {
  const h = fixture({ privacy: { privateAccount: true } }, { writeError: true });
  assert.equal((await h.update({ privacy: { readReceipts: false } })).ok, false);
  assert.deepEqual(h.settings, { privacy: { privateAccount: true } });
});

test("prototype keys are ignored in nested patches", async () => {
  const h = fixture({ privacy: { privateAccount: true } });
  await h.update(JSON.parse('{"privacy":{"__proto__":{"privateAccount":false},"readReceipts":false}}'));
  assert.deepEqual(h.settings, { privacy: { privateAccount: true, readReceipts: false } });
});

test("legacy canonical Private flag is reflected in settings reads", async () => {
  const h = fixture({privacy:{privateAccount:false,readReceipts:false}}, {privateProfile:true});
  const result = await h.get();
  assert.equal(result.data.settings.privacy.privateAccount,true);
  assert.equal(result.data.settings.privacy.readReceipts,false);
});

test("sibling and notification toggles cannot silently clear a legacy Private flag", async () => {
  for (const patch of [{privacy:{readReceipts:false}}, {notifications:{likes:false}}]) {
    const h = fixture({privacy:{privateAccount:false}}, {privateProfile:true});
    assert.equal((await h.update(patch)).ok,true);
    assert.equal(h.settings.privacy.privateAccount,true);
  }
  const explicit = fixture({privacy:{privateAccount:false}}, {privateProfile:true});
  assert.equal((await explicit.update({privacy:{privateAccount:false}})).ok,true);
  assert.equal(explicit.settings.privacy.privateAccount,false,'only an explicit Public choice may clear it');
});

test("unknown privacy read failures do not masquerade as Public", async () => {
  assert.equal((await fixture({}, {profileError:true}).get()).ok,false);
});

test("invalid privacy patches cannot clear a saved private choice", async () => {
  for(const privacy of [null,[],{privateAccount:null},{privateAccount:"false"}]) {
    const h = fixture({privacy:{privateAccount:true}});
    assert.equal((await h.update({privacy})).ok,false);
    assert.equal(h.writes,0);
  }
});
