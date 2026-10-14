import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

// Execute the real platform adapters and token cache, replacing only platform
// dependencies and the auth transport. Testing the cache callback alone misses
// an adapter that forgets to wire it (Next resolves .web.ts first).
const integration = String.raw`
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import { stripTypeScriptTypes } from "node:module";
  import { dirname, resolve } from "node:path";
  import { SourceTextModule } from "node:vm";

  const [root, adapter] = process.argv.slice(1);
  const modules = new Map();
  const authStore = resolve(root, "packages/app/lib/stores/auth-store.ts");
  const authLogger = resolve(root, "packages/app/lib/auth/auth-logger.ts");
  const stubs = {
    "@tanstack/react-query": "export class QueryClient {}",
    "expo-secure-store": "export async function deleteItemAsync() {}",
    [authLogger]: "export const logAuth = () => {};",
    [authStore]: 'export const useAuthStore = { subscribe: () => () => {}, getState: () => ({ user: { id: "17", authId: "a", email: "a@example.com" } }) };',
    "@dvnt/auth": [
      'const session = (id, token) => ({ data: { user: { id, email: id + "@example.com" }, session: { token } } });',
      'let pendingSignIn;',
      'export const transport = {',
      '  current: session("a", "a-old"),',
      '  finishSignIn(id, token) { this.current = session(id, token); pendingSignIn(this.current); },',
      '  setSession(id, token) { this.current = session(id, token); },',
      '};',
      'export const authClient = {',
      '  getSession: async () => transport.current,',
      '  signIn: { email: () => new Promise(resolve => { pendingSignIn = resolve; }) },',
      '  signUp: { email: async () => session("a", "a-signup") },',
      '  signOut: async () => ({}),',
      '};',
    ].join(" "),
  };
  function load(id) {
    if (modules.has(id)) return modules.get(id);
    const code = stubs[id] ?? stripTypeScriptTypes(readFileSync(id, "utf8"));
    const module = new SourceTextModule(code, { identifier: id });
    modules.set(id, module);
    return module;
  }
  function link(specifier, parent) {
    if (Object.hasOwn(stubs, specifier)) return load(specifier);
    const id = specifier.startsWith("@dvnt/app/")
      ? resolve(root, "packages/app", specifier.slice("@dvnt/app/".length))
      : resolve(dirname(parent.identifier), specifier);
    return load(id.endsWith(".ts") ? id : id + ".ts");
  }
  async function entry(id) {
    const module = load(id);
    if (module.status === "unlinked") await module.link(link);
    if (module.status === "linked") await module.evaluate();
    return module.namespace;
  }

  const lifecycle = await entry(resolve(root, "packages/app/lib/auth/session-lifecycle.ts"));
  const auth = await entry(resolve(root, "packages/app/lib", adapter));
  const { transport } = await entry("@dvnt/auth");
  const boundaries = [];
  lifecycle.subscribeSessionLifecycle(() => boundaries.push(lifecycle.getSessionLifecycle()));

  assert.equal(await auth.getAuthToken(), "a-old");
  assert.equal(lifecycle.getSessionLifecycle().epoch, 0, "ordinary token reads must not reset profile evidence");

  const login = auth.signIn.email({ email: "a@example.com", password: "fixture-only" });
  assert.deepEqual(lifecycle.getSessionLifecycle(), { epoch: 1, ready: false }, "sign-in clears proof before transport resolves");
  transport.finishSignIn("a", "a-new");
  await login;
  assert.deepEqual(lifecycle.getSessionLifecycle(), { epoch: 2, ready: true, authId: "a" }, "same-account login is still a new proof boundary");
  assert.equal(await auth.getAuthToken(), "a-new");
  auth.invalidateTokenCache();
  assert.equal(await auth.getAuthToken(), "a-new");
  assert.equal(lifecycle.getSessionLifecycle().epoch, 2, "token invalidation/refresh does not reset profile evidence");

  await auth.authClient.signOut();
  assert.deepEqual(boundaries.slice(-2).map(state => state.ready), [false, false]);
  assert.equal(await auth.getAuthToken(), null);
  assert.equal(lifecycle.getSessionLifecycle().epoch, 4);

  transport.setSession("a", "a-callback");
  assert.equal(await auth.resumeAuthSession(), true);
  assert.deepEqual(lifecycle.getSessionLifecycle(), { epoch: 5, ready: true, authId: "a" }, "same-account external callback publishes its new session");

  const otherLogin = auth.authClient.signIn.email({});
  assert.equal(lifecycle.getSessionLifecycle().ready, false);
  transport.finishSignIn("b", "b-new");
  await otherLogin;
  assert.deepEqual(lifecycle.getSessionLifecycle(), { epoch: 7, ready: true, authId: "b" }, "publish the new identity while the UI still has the previous profile");
`;

for (const adapter of ["auth-client.web.ts", "auth-client.ts"]) {
  test(adapter + " wires real auth boundaries to profile session evidence", () => {
    execFileSync(process.execPath, [
      "--no-warnings",
      "--experimental-vm-modules",
      "--input-type=module",
      "--eval",
      integration,
      root,
      adapter,
    ], { cwd: root, encoding: "utf8", timeout: 15_000 });
  });
}
