import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

/** Legacy grants disclose coarse bands; explicit reciprocal v2 grants may
 * disclose mileage with a short server-authorized display lease. */
export type MemberProximityBand =
  | "under_1"
  | "1_5"
  | "5_15"
  | "15_50"
  | "far";

export type MemberProximityResult =
  | { kind: "self"; label: null }
  | { kind: "unavailable"; label: null }
  | { kind: "city"; label: string | null }
  | { kind: "distance"; label: string; band: MemberProximityBand }
  | { kind: "distance"; label: string; consentVersion: 2; miles: number; expiresAt: string };

type EdgeResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeEdge<EdgeResponse<T>>(
    "member-proximity",
    body,
  );
  if (error) throw new Error(error.message);
  if (!data?.ok || data.data == null) {
    throw new Error(data?.error || "Member proximity is unavailable");
  }
  return data.data;
}

export const memberProximityApi = {
  consentExact(expectedAuthId: string, expectedSessionId: string) { return call<{ expiresAt: string; consentVersion: 2 }>({ action: "consentExact", consentVersion: 2, expectedAuthId, expectedSessionId }); },
  revokeExact(expectedAuthId: string) { return call<{ revoked: boolean }>({ action: "revokeExact", expectedAuthId }); },
  publish(input: {
    latitude: number;
    longitude: number;
    cityId?: number | null;
    accuracyMeters?: number | null;
    shareUntil: string;
    exactDistanceVersion?: 2;
    observedAt?: string;
    expectedAuthId?: string;
    expectedSessionId?: string;
  }) {
    return call<{ sharedUntil: string }>({ action: "publish", ...input });
  },

  revoke(expectedAuthId?: string) {
    return call<{ revoked: boolean }>({ action: "revoke", expectedAuthId });
  },

  /**
   * No viewer coordinates. The server reads the caller's own presence row, so
   * sending a position here would be ignored and offering the parameter only
   * invites a caller to try.
   */
  distance(input: { targetUsername: string; expectedAuthId?: string }) {
    return call<MemberProximityResult>({ action: "distance", ...input });
  },
};
