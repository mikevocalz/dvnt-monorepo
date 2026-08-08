'use client';

/**
 * /feed/[username] — same profile screen as /feed/profile/[username].
 * Comments, tag chips, and post headers all push `/feed/${username}`; this
 * segment had no page (only [username]/post), so every one of those 404'd.
 * Static /feed/* segments win route precedence over this dynamic one.
 */
import dynamic from 'next/dynamic';

const UserProfileScreen = dynamic(
  () => import('@dvnt/app/features/profile/user-profile.web').then((m) => m.UserProfileScreen),
  { ssr: false },
);

export default function Page() {
  return <UserProfileScreen />;
}
