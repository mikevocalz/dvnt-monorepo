// The signed-in member's own gender, sexuality and event_audience.
//
// These columns are members-only (20261003150500): a read that goes out before
// the JWT bridge attaches is a 42501. A failed read must never look like
// "nothing stored", or a form hydrated from it saves blanks over the member's
// real values and onboarding treats them as new. So the read reports failure
// explicitly, and identityPatch sends nothing for a form whose prefill failed.

export interface OwnIdentity {
  gender: string;
  sexuality: string[];
  eventAudience: string;
}

export type OwnIdentityLoad =
  | { status: "loading" }
  | { status: "ready"; baseline: OwnIdentity }
  | { status: "error" };

/** Fields for usersApi.updateProfile: omitted = untouched, null = clear. */
export interface IdentityPatch {
  gender?: string | null;
  sexuality?: string[] | null;
  eventAudience?: string | null;
}

// Loosely typed on purpose: matching SupabaseClient structurally is a TS2589
// (type instantiation too deep). Tests pass a small fake.
interface OwnIdentityClient {
  from(table: string): any;
}

/**
 * Reads the member's own identity row. Any error, and a missing row, is
 * { ok: false }: the caller cannot know what is stored.
 */
export async function fetchOwnIdentity(
  client: OwnIdentityClient,
  userId: string | number,
): Promise<{ ok: true; identity: OwnIdentity } | { ok: false }> {
  const id = Number(userId);
  if (!Number.isFinite(id)) return { ok: false };
  try {
    const { data, error } = await client
      .from("users")
      .select("gender, sexuality, event_audience")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return { ok: false };
    return {
      ok: true,
      identity: {
        gender: typeof data.gender === "string" ? data.gender : "",
        sexuality: Array.isArray(data.sexuality) ? data.sexuality : [],
        eventAudience: typeof data.event_audience === "string" ? data.event_audience : "",
      },
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Only fields the member changed from a successfully loaded baseline. A
 * changed-to-empty field is an explicit null (clear). Without a loaded
 * baseline nothing is sent.
 */
export function identityPatch(load: OwnIdentityLoad, current: OwnIdentity): IdentityPatch {
  if (load.status !== "ready") return {};
  const { baseline } = load;
  const patch: IdentityPatch = {};
  const gender = current.gender.trim();
  if (gender !== baseline.gender.trim()) patch.gender = gender || null;
  if (JSON.stringify(current.sexuality) !== JSON.stringify(baseline.sexuality)) {
    patch.sexuality = current.sexuality.length > 0 ? current.sexuality : null;
  }
  const audience = current.eventAudience.trim();
  if (audience !== baseline.eventAudience.trim()) patch.eventAudience = audience || null;
  return patch;
}

/** Onboarding is done only when a successful read shows saved identity. */
export function onboardingState(
  result: { ok: true; identity: OwnIdentity } | { ok: false },
): "done" | "needed" | "unknown" {
  if (!result.ok) return "unknown";
  return result.identity.sexuality.length > 0 ? "done" : "needed";
}
