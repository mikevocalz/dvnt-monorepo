/**
 * Post engagement controls — a transport-agnostic shared UI contract.
 *
 * PLATFORM BEHAVIOR: web renders semantic buttons; iOS/Android render Pressable.
 * Neither implementation fetches counts, mutates caches, or chooses navigation.
 * The owning feature supplies current counts and callbacks. Keep icon/count pairs
 * adjacent and zeros visible; do not reintroduce per-screen hidden-count branches.
 *
 * This base is intentionally inert: platform exports provide the real renderer.
 */
export type { PostEngagementCountsProps } from "./PostEngagementCounts.types";
import type { PostEngagementCountsProps } from "./PostEngagementCounts.types";

export function PostEngagementCounts(_props: PostEngagementCountsProps): null {
  return null;
}
