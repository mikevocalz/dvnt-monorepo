import type { MediaKind } from "@/lib/media/types";

interface DVNTMediaBadgeProps {
  kind: MediaKind;
}

// Badges removed per product decision — media plays naturally without type labels.
// Component retained for potential future analytics/QA use.
export function DVNTMediaBadge(_props: DVNTMediaBadgeProps) {
  return null;
}
