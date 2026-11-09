import { Text } from "react-native";
import { useMemberProximity } from "@dvnt/app/lib/hooks/use-member-proximity";
import { memberDistanceLabel } from "@dvnt/app/lib/location/member-distance-label";

/** Same server consent, query cache and wording as the profile badge. */
export function MemberDistanceBadge({ username }: { username?: string | null }) {
  const result = useMemberProximity(username);
  const label = memberDistanceLabel(result.data);
  return label ? <Text numberOfLines={2} style={{ color: "#ddd", fontSize: 11 }}>({label})</Text> : null;
}
