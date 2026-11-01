import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

export interface LocationSettings {
  locationEnabled: boolean;
  eventsMapEnabled: boolean;
  revision: number;
  shareUntil: string | null;
}
export interface NearbyMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  latitude: number;
  longitude: number;
  expiresAt: string;
}
export interface NearbyMembers {
  /** Validated coarse server presence; absent on older deployments, null when unavailable. */
  self?: NearbyMember | null;
  members: NearbyMember[];
  center: { latitude: number; longitude: number } | null;
  expiresAt: string | null;
}
export class MemberMapError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, details: { code?: string; status?: number } = {}) {
    super(message); this.name = "MemberMapError";
    this.code = details.code; this.status = details.status;
  }
}
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeEdge<{ ok: boolean; data?: T; error?: string; code?: string; status?: number }>("member-map", body);
  if (error) throw new MemberMapError(error.message, error);
  if (!data?.ok || !data.data) throw new MemberMapError(data?.error || "Location settings are unavailable. Please retry.", { code: data?.code, status: data?.status });
  return data.data;
}
export const memberMapApi = {
  settings: (expectedAuthId: string) => call<LocationSettings>({ action: "settings", expectedAuthId }),
  updateSettings: (expectedAuthId: string, input: { expectedRevision: number; locationEnabled: boolean; eventsMapEnabled: boolean; shareDurationHours?: 1 | 4; consentVersion?: "events-map-v1" }) => call<LocationSettings>({ action: "updateSettings", expectedAuthId, ...input }),
  revoke: (expectedAuthId: string, scope: "overall" | "events" = "events") => call<LocationSettings>({ action: "revoke", expectedAuthId, scope }),
  publish: (expectedAuthId: string, input: { revision: number; latitude: number; longitude: number; observedAt: string }) => call<{ published: true; expiresAt: string }>({ action: "publish", expectedAuthId, ...input }),
  nearby: (expectedAuthId: string) => call<NearbyMembers>({ action: "nearby", expectedAuthId }),
};
