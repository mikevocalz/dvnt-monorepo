import { test } from "node:test";
import assert from "node:assert/strict";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { createAuthClient } from "better-auth/client";
import { memoryAdapter } from "better-auth/adapters/memory";
import { checkAccountCreationAdmission } from "../../../../apps/mobile/supabase/functions/_shared/age-policy.ts";

const origin = "http://localhost:3000";
const password = "test-only-password-123";

function setup() {
  const db: Record<string, any[]> = { user: [], account: [], session: [], verification: [] };
  const observed: Array<{ path: unknown; dob: unknown }> = [];
  let providerEmail = "new-social@example.com";
  // Mock only provider identity/JWKS transport. Better Auth routes, adapters,
  // account linking and before-create hook execute for real, without network.
  const provider = {
    clientId: "test-client", clientSecret: "test-secret",
    disableSignUp: true, disableImplicitSignUp: true,
    verifyIdToken: async () => true,
    getUserInfo: async () => ({
      user: { id: providerEmail, email: providerEmail, name: "Test member", emailVerified: true },
      data: {},
    }),
  };
  const auth = betterAuth({
    baseURL: origin,
    secret: "test-only-age-contract-secret-not-for-production",
    database: memoryAdapter(db),
    logger: { disabled: true },
    emailAndPassword: { enabled: true },
    socialProviders: { google: provider, apple: provider },
    account: { accountLinking: { enabled: true, trustedProviders: ["google", "apple"] } },
    databaseHooks: { user: { create: { before: async (user, context) => {
      observed.push({ path: context?.path, dob: context?.body?.dateOfBirth });
      const admission = checkAccountCreationAdmission(context?.path, context?.body, user.email);
      if (!admission.allowed) throw new APIError("FORBIDDEN", {
        code: admission.code || "AGE_REGISTRATION_REQUIRED",
        message: admission.message || "Age registration required",
      });
      return { data: user };
    } } } },
  });
  const post = async (path: string, body: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const response = await auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...headers },
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { auth, db, observed, post, setProviderEmail: (email: string) => { providerEmail = email; } };
}

test("real Better Auth client forwards DOB to the before-create context without persisting it", async () => {
  const { auth, db, observed, post } = setup();
  const client = createAuthClient({
    baseURL: origin,
    fetchOptions: { customFetchImpl: (url, init) => auth.handler(new Request(url, init)) },
  });
  const result = await client.signUp.email({ email: "adult@example.com", password, name: "Adult", dateOfBirth: "2000-01-01" } as any);
  assert.equal(result.error, null);
  assert.equal(db.user.length, 1);
  assert.deepEqual(observed, [{ path: "/sign-up/email", dob: "2000-01-01" }]);
  assert.equal(Object.hasOwn(db.user[0], "dateOfBirth"), false);
  const signIn = await post("/sign-in/email", { email: "adult@example.com", password });
  assert.equal(signIn.status, 200);
  assert.equal(observed.length, 1, "existing login must not run new-user admission");
});

test("real signup and direct server creation cannot bypass DOB admission", async () => {
  const { auth, db, post } = setup();
  for (const [index, dateOfBirth] of [undefined, "2090-01-01", "2000-02-30", "2015-01-01"].entries()) {
    const response = await post("/sign-up/email", { email: `blocked${index}@example.com`, password, name: "Blocked", dateOfBirth }, {
      "x-dvnt-internal-signup-dob": "2000-01-01", "x-dvnt-internal-signup-email": `blocked${index}@example.com`,
    });
    assert.equal(response.status, 403);
    assert.equal(db.user.length, 0);
    assert.equal(db.account.length, 0);
  }
  await assert.rejects(auth.api.signUpEmail({ body: { email: "server@example.com", password, name: "Blocked" } }));
  const context = await auth.$context;
  await assert.rejects(context.internalAdapter.createUser({ email: "internal@example.com", name: "Blocked", emailVerified: false }));
  assert.equal(db.user.length, 0);
});

test("new Google and Apple users are blocked while existing verified accounts sign in and link", async () => {
  const { db, post, setProviderEmail } = setup();
  for (const provider of ["google", "apple"]) {
    for (const requestSignUp of [false, true]) {
      const result = await post("/sign-in/social", { provider, requestSignUp, idToken: { token: "mock-provider-token" } });
      assert.equal(result.status, 401);
      assert.equal(db.user.length, 0);
      assert.equal(db.account.length, 0);
    }
  }
  await post("/sign-up/email", { email: "adult@example.com", password, name: "Adult", dateOfBirth: "2000-01-01" });
  const id = db.user[0].id;
  db.user[0].emailVerified = true; // Fixture: user has already confirmed their email.
  setProviderEmail("adult@example.com");
  for (const provider of ["google", "apple"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await post("/sign-in/social", { provider, idToken: { token: "mock-provider-token" } });
      assert.equal(result.status, 200);
      assert.equal(result.body.user.id, id);
      assert.equal(db.user.length, 1);
    }
  }
  assert.equal(db.account.length, 3, "one credential and two social links; no duplicate user");
});
