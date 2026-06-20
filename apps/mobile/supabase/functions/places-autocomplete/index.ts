import { checkRateLimit } from "../_shared/rate-limit.ts";
import { corsHeaders } from "../_shared/verify-session.ts";

type LatLng = { latitude: number; longitude: number };

const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat";
const DEFAULT_BIAS_CENTER: LatLng = { latitude: 34.0522, longitude: -118.2437 };
const DEFAULT_RADIUS_METERS = 50_000;

function jsonResponse(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function getPlacesApiKey() {
  return (
    Deno.env.get("GOOGLE_PLACES_API_KEY") ||
    Deno.env.get("GOOGLE_MAPS_API_KEY") ||
    ""
  );
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveBias(body: Record<string, unknown>) {
  const candidate = body.locationBias as Record<string, unknown> | undefined;
  const latitude = toFiniteNumber(candidate?.latitude);
  const longitude = toFiniteNumber(candidate?.longitude);
  const radius = toFiniteNumber(candidate?.radiusMeters) ?? DEFAULT_RADIUS_METERS;

  return {
    latitude: latitude ?? DEFAULT_BIAS_CENTER.latitude,
    longitude: longitude ?? DEFAULT_BIAS_CENTER.longitude,
    radiusMeters: Math.max(1_000, Math.min(radius, DEFAULT_RADIUS_METERS)),
  };
}

function normalizeSuggestion(suggestion: any) {
  const prediction = suggestion?.placePrediction;
  if (!prediction?.placeId) return null;

  return {
    placeId: prediction.placeId,
    mainText:
      prediction.structuredFormat?.mainText?.text ||
      prediction.text?.text ||
      "",
    secondaryText: prediction.structuredFormat?.secondaryText?.text || "",
    fullText: prediction.text?.text || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { ok: false, error: "Method not allowed" }, 405);
  }

  const identifier =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";
  const rateLimit = checkRateLimit(identifier, "places-autocomplete", {
    maxRequests: 90,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return jsonResponse(
      req,
      { ok: false, error: "Too many location searches. Try again shortly." },
      429,
    );
  }

  const apiKey = getPlacesApiKey();
  if (!apiKey) {
    return jsonResponse(
      req,
      { ok: false, error: "Google Places API key is not configured." },
      500,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { ok: false, error: "Invalid JSON body." }, 400);
  }

  const input = String(body.input || "").trim();
  const sessionToken = String(body.sessionToken || "").trim();
  if (input.length < 2) {
    return jsonResponse(req, { ok: true, predictions: [] });
  }
  if (!sessionToken) {
    return jsonResponse(req, { ok: false, error: "Missing sessionToken." }, 400);
  }

  const bias = resolveBias(body);

  // Do not send includedPrimaryTypes here. Google's Autocomplete (New) caps it
  // at five primary types, and this field must serve both venues/POIs and street
  // addresses. Location bias + US region filtering keeps ranking local without
  // excluding valid restaurants, bars, clubs, premises, or addresses.
  const googleBody = {
    input,
    sessionToken,
    languageCode: "en",
    includedRegionCodes: ["us"],
    locationBias: {
      circle: {
        center: {
          latitude: bias.latitude,
          longitude: bias.longitude,
        },
        radius: bias.radiusMeters,
      },
    },
  };

  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
    },
    body: JSON.stringify(googleBody),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[places-autocomplete] Google error", response.status, data);
    return jsonResponse(
      req,
      { ok: false, error: "Location search is unavailable right now." },
      502,
    );
  }

  const predictions = (data.suggestions || [])
    .map(normalizeSuggestion)
    .filter(Boolean);

  return jsonResponse(req, {
    ok: true,
    predictions,
    bias: {
      latitude: bias.latitude,
      longitude: bias.longitude,
      radiusMeters: bias.radiusMeters,
    },
  });
});
