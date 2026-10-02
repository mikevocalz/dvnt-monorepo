import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

export type MemberProximityResult =
  | { kind: "self"; label: null }
  | { kind: "unavailable"; label: null }
  | { kind: "city"; label: string | null }
  | { kind: "distance"; label: string; miles: number };

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

  distance(input: {
    targetUsername: string;
    viewerLatitude?: number | null;
    viewerLongitude?: number | null;
  }) {
    return call<MemberProximityResult>({ action: "distance", ...input });
  },
};
