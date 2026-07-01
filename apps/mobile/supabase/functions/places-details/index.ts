import { checkRateLimit } from "../_shared/rate-limit.ts";
import { corsHeaders } from "../_shared/verify-session.ts";

const DETAILS_FIELD_MASK =
  "displayName,formattedAddress,addressComponents,location,types";

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

function componentValue(
  components: any[],
  type: string,
  mode: "longText" | "shortText",
) {
  const match = components.find(
    (component) =>
      Array.isArray(component?.types) && component.types.includes(type),
  );
  return match?.[mode] || "";
}

function normalizePlace(place: any, placeId: string) {
  const addressComponents = Array.isArray(place?.addressComponents)
    ? place.addressComponents
    : [];
  const latitude = Number(place?.location?.latitude);
  const longitude = Number(place?.location?.longitude);

  const city =
    componentValue(addressComponents, "locality", "longText") ||
    componentValue(addressComponents, "postal_town", "longText") ||
    componentValue(addressComponents, "administrative_area_level_3", "longText");

  return {
    placeId,
    name: place?.displayName?.text || place?.formattedAddress || "",
    formattedAddress: place?.formattedAddress || "",
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined,
    city,
    state: componentValue(addressComponents, "administrative_area_level_1", "shortText"),
    postalCode: componentValue(addressComponents, "postal_code", "longText"),
    country: componentValue(addressComponents, "country", "shortText"),
    addressComponents,
    types: Array.isArray(place?.types) ? place.types : [],
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
  const rateLimit = checkRateLimit(identifier, "places-details", {
    maxRequests: 45,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return jsonResponse(
      req,
      { ok: false, error: "Too many location selections. Try again shortly." },
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

  const placeId = String(body.placeId || "").trim();
  const sessionToken = String(body.sessionToken || "").trim();
  if (!placeId) {
    return jsonResponse(req, { ok: false, error: "Missing placeId." }, 400);
  }
  if (!sessionToken) {
    return jsonResponse(req, { ok: false, error: "Missing sessionToken." }, 400);
  }

  const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
  url.searchParams.set("sessionToken", sessionToken);

  const response = await fetch(url.toString(), {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAILS_FIELD_MASK,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[places-details] Google error", response.status, data);
    return jsonResponse(
      req,
      { ok: false, error: "Location details are unavailable right now." },
      502,
    );
  }

  return jsonResponse(req, {
    ok: true,
    place: normalizePlace(data, placeId),
  });
});
