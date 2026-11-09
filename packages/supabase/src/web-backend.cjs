"use strict";

// Public configuration only. Shared by Next's rewrites and its browser client.
const FALLBACK_SUPABASE_URL = "https://npfjanxturvmjyevoyfo.supabase.co";
// This is the existing public anon key, never a service-role credential.
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZmphbnh0dXJ2bWp5ZXZveWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MjA0MjMsImV4cCI6MjA4Mzk5NjQyM30.v88MMGqv2db8hn8llr5aToKbKUDOHz-AxZbZYA5RLGM";


function publicUrl(value, label, originOnly) {
  let url;
  try {
    if (typeof value !== "string" || !value || value !== value.trim()) throw new Error();
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute public backend URL`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username || url.password || url.search || url.hash ||
      (originOnly && url.pathname !== "/")) {
    throw new Error(`${label} must be HTTPS (HTTP loopback is allowed), without credentials, query, fragment or backend path`);
  }
  return originOnly ? url.origin : url.href.replace(/\/$/, "");
}

function resolveWebBackend(rawUrl, rawAnonKey) {
  const supabaseUrl = publicUrl(rawUrl === undefined ? FALLBACK_SUPABASE_URL : rawUrl, "Supabase URL", true);
  if (rawAnonKey === undefined && supabaseUrl !== FALLBACK_SUPABASE_URL) {
    throw new Error("A configured Supabase backend requires its own public anon or publishable key");
  }
  const supabaseAnonKey = rawAnonKey === undefined ? FALLBACK_SUPABASE_ANON_KEY : rawAnonKey;
  if (typeof supabaseAnonKey !== "string" || !supabaseAnonKey || supabaseAnonKey !== supabaseAnonKey.trim()) {
    throw new Error("Supabase public key must not be blank");
  }
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabaseAnonKey)) {
    let claims;
    try {
      const parts = supabaseAnonKey.split(".");
      if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
      claims = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      throw new Error("Supabase key must be a public anon JWT or publishable key");
    }
    if (!claims || claims.role !== "anon") throw new Error("Only an anon or publishable Supabase key may be exposed to web clients");
    const project = new URL(supabaseUrl).hostname.match(/^([^.]+)\.supabase\.co$/)?.[1];
    if (project && claims.ref !== project) throw new Error("Supabase public key belongs to a different project");
  }
  return { supabaseUrl, supabaseAnonKey };
}

function resolveNextWebBackend(env) {
  const backend = resolveWebBackend(
    env.NEXT_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  );
  const authUrl = publicUrl(
    env.NEXT_PUBLIC_AUTH_URL ?? env.EXPO_PUBLIC_AUTH_URL ?? `${backend.supabaseUrl}/functions/v1/auth`,
    "Auth URL", false,
  );
  const authOrigin = new URL(authUrl).origin;
  const isSupabaseHost = value => new URL(value).hostname.endsWith(".supabase.co");
  // Preserve explicit custom auth domains. Their routing must be verified by
  // the operator; a hostname alone cannot establish their backing project.
  // Two known Supabase project origins, however, must never be mixed.
  if (authOrigin !== backend.supabaseUrl &&
      ((isSupabaseHost(authUrl) && isSupabaseHost(backend.supabaseUrl)) ||
       authOrigin === FALLBACK_SUPABASE_URL)) {
    throw new Error("Auth URL must not target a different Supabase project");
  }
  return { ...backend, authUrl };
}

module.exports = { resolveWebBackend, resolveNextWebBackend };
