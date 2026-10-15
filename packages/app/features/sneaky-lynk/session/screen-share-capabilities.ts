/**
 * Safe presentation boundary for screen share. UI may advertise a control only
 * when capture and publishing are actually supported. No fake button.
 * The real MoQ source-switch and native capture plugin are separate work.
 */
export type SharePlatform = "web" | "ios" | "android";
export interface ScreenShareContext {
  platform: SharePlatform;
  isVerifiedAdult: boolean;
  hasActiveRoomMembership: boolean;
  role: "host" | "co-host" | "speaker" | "participant" | "listener";
  roomAllowsSharing: boolean;
  captureSupported: boolean;
  publishSupported: boolean;
}
export function canOfferScreenShare(c: ScreenShareContext): boolean {
  // Call-site must detect real browser getDisplayMedia and a compatible MoQ
  // publisher. Android/iOS require their own native-capture integration.
  return c.isVerifiedAdult && c.hasActiveRoomMembership &&
    c.roomAllowsSharing && c.captureSupported && c.publishSupported &&
    (c.role === "host" || c.role === "co-host" || c.role === "speaker");
}
