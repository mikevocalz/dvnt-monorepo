import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

/**
 * The bands the server will answer with. A mileage is deliberately absent:
 * `miles` was trilaterable across repeated reads, so the server now returns a
 * band and the label that goes with it. `kind` and `label` are unchanged, which
 * is all the profile badge reads.
 */
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
  | { kind: "distance"; label: string; band: MemberProximityBand };

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
  publish(input: {
    latitude: number;
    longitude: number;
    cityId?: number | null;
    accuracyMeters?: number | null;
    shareUntil: string;
  }) {
    return call<{ sharedUntil: string }>({ action: "publish", ...input });
  },

  revoke() {
    return call<{ revoked: boolean }>({ action: "revoke" });
  },

  /**
   * No viewer coordinates. The server reads the caller's own presence row, so
   * sending a position here would be ignored and offering the parameter only
   * invites a caller to try.
   */
  distance(input: { targetUsername: string }) {
    return call<MemberProximityResult>({ action: "distance", ...input });
  },
};
