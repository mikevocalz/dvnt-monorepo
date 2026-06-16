/**
 * Test script for Bunny CDN upload flow
 *
 * Run with: npx ts-node scripts/test-bunny-upload.ts
 * Or import and call testBunnyUpload() from the app
 */

// Environment check
export function checkBunnyConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const zone = process.env.EXPO_PUBLIC_BUNNY_STORAGE_ZONE;
  const apiKey = process.env.EXPO_PUBLIC_BUNNY_STORAGE_API_KEY;
  const region = process.env.EXPO_PUBLIC_BUNNY_STORAGE_REGION;
  const cdnUrl = process.env.EXPO_PUBLIC_BUNNY_CDN_URL;

  if (!zone) errors.push("EXPO_PUBLIC_BUNNY_STORAGE_ZONE is not set");
  if (!apiKey) errors.push("EXPO_PUBLIC_BUNNY_STORAGE_API_KEY is not set");
  if (!region) errors.push("EXPO_PUBLIC_BUNNY_STORAGE_REGION is not set");
  if (!cdnUrl) errors.push("EXPO_PUBLIC_BUNNY_CDN_URL is not set");

  console.log("\n=== Bunny CDN Configuration ===");
  console.log("Storage Zone:", zone ? `✓ ${zone}` : "✗ MISSING");
  console.log(
    "API Key:",
    apiKey ? `✓ (${apiKey.substring(0, 8)}...)` : "✗ MISSING",
  );
  console.log("Region:", region ? `✓ ${region}` : "✗ MISSING");
  console.log("CDN URL:", cdnUrl ? `✓ ${cdnUrl}` : "✗ MISSING");
  console.log("================================\n");

  return { valid: errors.length === 0, errors };
}

// Test upload with a simple blob
export async function testBunnyUpload(): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  const zone = process.env.EXPO_PUBLIC_BUNNY_STORAGE_ZONE || "";
  const apiKey = process.env.EXPO_PUBLIC_BUNNY_STORAGE_API_KEY || "";
  const region = process.env.EXPO_PUBLIC_BUNNY_STORAGE_REGION || "ny";
  const cdnUrl = process.env.EXPO_PUBLIC_BUNNY_CDN_URL || "";

  if (!zone || !apiKey) {
    return { success: false, error: "Missing Bunny configuration" };
  }

  // Create a test file (1x1 red pixel PNG)
  const testImageBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const testImageBuffer = Uint8Array.from(atob(testImageBase64), (c) =>
    c.charCodeAt(0),
  );
  const blob = new Blob([testImageBuffer], { type: "image/png" });

  // Generate test path
  const timestamp = Date.now();
  const testPath = `test/${timestamp}-test-upload.png`;

  // Build upload URL
  const endpoint =
    region === "de" || region === "falkenstein"
      ? "storage.bunnycdn.com"
      : `${region}.storage.bunnycdn.com`;
  const uploadUrl = `https://${endpoint}/${zone}/${testPath}`;

  console.log("\n=== Testing Bunny Upload ===");
  console.log("Upload URL:", uploadUrl);
  console.log("Test path:", testPath);

  try {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        AccessKey: apiKey,
        "Content-Type": "application/octet-stream",
      },
      body: blob,
    });

    console.log("Response status:", response.status);
    console.log("Response text:", await response.text());

    if (response.status === 201 || response.status === 200) {
      const finalUrl = cdnUrl
        ? `${cdnUrl}/${testPath}`
        : `https://${zone}.b-cdn.net/${testPath}`;

      console.log("\n✓ Upload successful!");
      console.log("CDN URL:", finalUrl);
      console.log("============================\n");

      // Verify the URL is accessible
      console.log("Verifying URL accessibility...");
      const verifyResponse = await fetch(finalUrl, { method: "HEAD" });
      console.log("Verify status:", verifyResponse.status);

      if (verifyResponse.ok) {
        console.log("✓ URL is accessible!");
      } else {
        console.log("✗ URL returned:", verifyResponse.status);
      }

      return { success: true, url: finalUrl };
    } else {
      console.log("\n✗ Upload failed!");
      console.log("============================\n");
      return {
        success: false,
        error: `Upload failed with status ${response.status}`,
      };
    }
  } catch (error) {
    console.error("\n✗ Upload error:", error);
    console.log("============================\n");
    return { success: false, error: String(error) };
  }
}

// Run if called directly
if (typeof require !== "undefined" && require.main === module) {
  checkBunnyConfig();
  testBunnyUpload().then((result) => {
    console.log("\nFinal result:", result);
    process.exit(result.success ? 0 : 1);
  });
}
