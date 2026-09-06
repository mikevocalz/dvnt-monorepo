/**
 * Rewrites Lynk copy for the Calls UI.
 *
 * `call_join` proxies to the `video_join_room` edge function, which is the
 * Sneaky Lynk room path and words its errors for Lynk. Hanging up a call and
 * reopening it therefore told the user "This Lynk's session has ended" — on a
 * call screen, about a call, with no Lynk anywhere in sight. Translating here
 * rather than in the edge function keeps Lynk's own copy correct, and covers
 * native and web from one place.
 *
 * Standalone and RN-free on purpose: call-rooms.ts imports the Supabase
 * client, so nothing could test this rule without dragging that along.
 */

const REWRITES: Record<string, string> = {
  "This Lynk's session has ended": "This call has ended",
  "Room is no longer open": "This call has ended",
  "Room not found": "Call not found",
  "Room is full": "This call is full",
  "You are banned from this room": "You can't join this call",
};

/** Unmapped messages pass through — better unfamiliar than confidently wrong. */
export function callErrorMessage(message: string): string {
  return REWRITES[message] ?? message;
}
