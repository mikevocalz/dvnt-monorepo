"use client";

/**
 * Followers list — WEB variant (port of
 * `app/(protected)/profile/followers.tsx`). Thin wrapper over the shared
 * `<FollowList />`; all data wiring (useInfiniteQuery → usersApi.getFollowers,
 * useFollow) lives there. See follow-list.web.tsx for the conventions.
 */

import { FollowList } from "./follow-list.web";

export function FollowersScreen() {
  return <FollowList variant="followers" />;
}

export default FollowersScreen;
