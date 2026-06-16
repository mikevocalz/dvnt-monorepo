/**
 * CONTRACT TESTS - Verify API endpoints return expected shapes
 *
 * Run with: npx ts-node scripts/contract-tests.ts
 * Or: npx tsx scripts/contract-tests.ts
 *
 * ALL TESTS MUST PASS BEFORE SHIPPING
 */

const BASE_URL = "https://npfjanxturvmjyevoyfo.supabase.co";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  status?: number;
}

const results: TestResult[] = [];

async function testEndpoint(
  name: string,
  method: string,
  endpoint: string,
  expectedFields: string[],
  authToken?: string,
): Promise<void> {
  const url = `${BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authToken) {
    headers["Authorization"] = `JWT ${authToken}`;
  }

  try {
    const res = await fetch(url, { method, headers });
    const data = await res.json();

    if (!res.ok && res.status !== 401) {
      results.push({
        name,
        passed: false,
        error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 100)}`,
        status: res.status,
      });
      return;
    }

    // Check for expected fields
    const missingFields: string[] = [];
    for (const field of expectedFields) {
      if (!(field in data)) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      results.push({
        name,
        passed: false,
        error: `Missing fields: ${missingFields.join(", ")}`,
        status: res.status,
      });
    } else {
      results.push({
        name,
        passed: true,
        status: res.status,
      });
    }
  } catch (err: any) {
    results.push({
      name,
      passed: false,
      error: `Network error: ${err.message}`,
    });
  }
}

async function runTests() {
  console.log("============================================================");
  console.log("CONTRACT TESTS");
  console.log("BASE:", BASE_URL);
  console.log("============================================================\n");

  // Test 1: GET /api/users/me - should return { user: ... } or { user: null }
  await testEndpoint("GET /api/users/me", "GET", "/api/users/me", ["user"]);

  // Test 2: GET /api/posts - should return paginated response
  await testEndpoint("GET /api/posts", "GET", "/api/posts?limit=1", [
    "docs",
    "totalDocs",
    "limit",
    "page",
    "hasNextPage",
  ]);

  // Test 3: GET /api/users - should return paginated response
  await testEndpoint("GET /api/users", "GET", "/api/users?limit=1", [
    "docs",
    "totalDocs",
    "limit",
    "page",
  ]);

  // Test 4: GET /api/users/:id/profile - should return profile shape
  await testEndpoint(
    "GET /api/users/15/profile",
    "GET",
    "/api/users/15/profile",
    ["id", "username", "followersCount", "followingCount", "postsCount"],
  );

  // Test 5: GET /api/posts/:id/comments - should return paginated response
  await testEndpoint(
    "GET /api/posts/18/comments",
    "GET",
    "/api/posts/18/comments",
    ["docs"],
  );

  // Test 6: GET /api/stories - should return paginated or grouped response
  await testEndpoint("GET /api/stories", "GET", "/api/stories", ["docs"]);

  // Print results
  console.log("\n============================================================");
  console.log("RESULTS");
  console.log("============================================================");

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.passed) {
      console.log(`✓ PASS: ${result.name} (${result.status})`);
      passed++;
    } else {
      console.log(`✗ FAIL: ${result.name}`);
      console.log(`        ${result.error}`);
      failed++;
    }
  }

  console.log("\n============================================================");
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log("============================================================");

  if (failed > 0) {
    console.log("\n✗ CONTRACT TESTS FAILED - DO NOT SHIP");
    process.exit(1);
  } else {
    console.log("\n✓ ALL CONTRACT TESTS PASSED");
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
