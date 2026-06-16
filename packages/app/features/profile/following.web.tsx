"use client";

/**
 * Following list — WEB variant (port of
 * `app/(protected)/profile/following.tsx`). Thin wrapper over the shared
 * `<FollowList />`; all data wiring (useInfiniteQuery → usersApi.getFollowing,
 * useFollow) lives there. See follow-list.web.tsx for the conventions.
 */

import { FollowList } from "./follow-list.web";

export function FollowingScreen() {
  return <FollowList variant="following" />;
}

export default FollowingScreen;
