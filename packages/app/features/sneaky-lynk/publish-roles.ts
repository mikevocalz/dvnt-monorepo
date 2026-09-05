/**
 * Who may publish media in a Lynk.
 *
 * ONE definition for both rails. This rule existed three times — in
 * `lynk-moq-token` (PUBLISH_ROLES), in the web room, and in `useVideoRoom` for
 * native — and they disagreed: the server was updated to let a `participant`
 * publish while both clients still gated on host/co-host/speaker, so a guest
 * held a publish token they never asked for and the host saw an avatar.
 *
 * `participant` is the role EVERY joiner gets (`video_join_room`), so leaving
 * it out makes a Lynk a broadcast rather than a room. Rooms are capped at
 * 2..50 and plan-limited at creation, so "everyone who joins is on camera" is
 * bounded — the Zoom model, not an open firehose. Camera and mic still start
 * from the pre-join choice; publishing is a CAPABILITY here, never a state.
 *
 * Keep in step with `PUBLISH_ROLES` in
 * `apps/mobile/supabase/functions/lynk-moq-token/index.ts`.
 */
export const PUBLISH_ROLES = ["host", "co-host", "speaker", "participant"] as const;

export function isPublisherRole(role?: string | null): boolean {
  return !!role && (PUBLISH_ROLES as readonly string[]).includes(role);
}
