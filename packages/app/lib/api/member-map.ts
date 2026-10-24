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
  members: NearbyMember[];
  center: { latitude: number; longitude: number } | null;
  expiresAt: string | null;
}
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeEdge<{ ok: boolean; data?: T; error?: string }>("member-map", body);
  if (error) throw new Error(error.message);
  if (!data?.ok || !data.data) throw new Error(data?.error || "Location settings are unavailable. Please retry.");
  return data.data;
}
export const memberMapApi = {
  settings: (expectedAuthId: string) => call<LocationSettings>({ action: "settings", expectedAuthId }),
  updateSettings: (expectedAuthId: string, input: { expectedRevision: number; locationEnabled: boolean; eventsMapEnabled: boolean; consentVersion?: "events-map-v1" }) => call<LocationSettings>({ action: "updateSettings", expectedAuthId, ...input }),
  revoke: (expectedAuthId: string, scope: "overall" | "events" = "events") => call<LocationSettings>({ action: "revoke", expectedAuthId, scope }),
  publish: (expectedAuthId: string, input: { revision: number; latitude: number; longitude: number; observedAt: string }) => call<{ published: true; expiresAt: string }>({ action: "publish", expectedAuthId, ...input }),
  nearby: (expectedAuthId: string) => call<NearbyMembers>({ action: "nearby", expectedAuthId }),
};
