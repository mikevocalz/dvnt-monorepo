#!/usr/bin/env ts-node
/**
 * Generate Apple Client Secret (JWT) for Sign in with Apple
 *
 * Usage:
 *   ts-node scripts/generate-apple-client-secret.ts \
 *     --key /path/to/AuthKey_XXXXXXXXXX.p8 \
 *     --key-id XXXXXXXXXX \
 *     --team-id XXXXXXXXXX \
 *     --client-id com.dvnt.app
 *
 * Then set in Supabase secrets:
 *   supabase secrets set APPLE_CLIENT_ID com.dvnt.app
 *   supabase secrets set APPLE_CLIENT_SECRET <output-jwt>
 */

import * as fs from "fs";
import * as path from "path";

// Simple JWT implementation without external deps
function base64UrlEscape(str: string): string {
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(str: string): string {
  str += new Array(5 - (str.length % 4)).join("=");
  return str.replace(/\-/g, "+").replace(/\_/g, "/");
}

function sign(data: string, key: string): string {
 // Use Node crypto for ES256 signing
  const crypto = require("crypto");
  const signer = crypto.createSign("SHA256");
  signer.update(data);
  return base64UrlEscape(signer.sign(key, "base64"));
}

function generateJWT(
  teamId: string,
  clientId: string,
  keyId: string,
  privateKey: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 15777000; // ~6 months (Apple allows up to 6 months)

  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  };

  const payload = {
    iss: teamId,
    iat: now,
    exp: exp,
    aud: "https://appleid.apple.com",
    sub: clientId,
  };

  const headerB64 = base64UrlEscape(Buffer.from(JSON.stringify(header)).toString("base64"));
  const payloadB64 = base64UrlEscape(Buffer.from(JSON.stringify(payload)).toString("base64"));
  const signatureInput = `${headerB64}.${payloadB64}`;
  const signature = sign(signatureInput, privateKey);

  return `${signatureInput}.${signature}`;
}

// Parse CLI args
const args = process.argv.slice(2);
const keyPath = args.find((_, i) => args[i - 1] === "--key") || "";
const keyId = args.find((_, i) => args[i - 1] === "--key-id") || "";
const teamId = args.find((_, i) => args[i - 1] === "--team-id") || "";
const clientId = args.find((_, i) => args[i - 1] === "--client-id") || "com.dvnt.app";

if (!keyPath || !keyId || !teamId) {
  console.log(`
Generate Apple Client Secret for Sign in with Apple

Required args:
  --key       Path to .p8 private key file from Apple Developer
  --key-id    Key ID (10 chars, shown in Apple Developer)
  --team-id   Apple Team ID (e.g., 436WA3W63V)
  --client-id Services ID (default: com.dvnt.app)

Example:
  ts-node scripts/generate-apple-client-secret.ts \\
    --key ~/Downloads/AuthKey_3CD5WWXJ5U.p8 \\
    --key-id 3CD5WWXJ5U \\
    --team-id 436WA3W63V

Then set the secret:
  supabase secrets set APPLE_CLIENT_SECRET <jwt-output>
`);
  process.exit(1);
}

const privateKey = fs.readFileSync(path.resolve(keyPath), "utf-8");
const jwt = generateJWT(teamId, clientId, keyId, privateKey);

console.log("\n✅ Apple Client Secret (JWT):\n");
console.log(jwt);
console.log("\n📋 Set in Supabase:");
console.log(`  supabase secrets set APPLE_CLIENT_ID ${clientId}`);
console.log(`  supabase secrets set APPLE_CLIENT_SECRET ${jwt.substring(0, 20)}...`);
