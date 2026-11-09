import { useRouter } from "expo-router";
import { UserCheck } from "lucide-react-native";
import { useFollowRequests } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { SettingsListItem } from "./ui/SettingsListItem";

export function FollowRequestsSetting() {
  const owner = useAuthStore((s) => s.user?.id);
  return owner ? <RequestSetting key={owner} /> : null;
}

function RequestSetting() {
  const router = useRouter();
  const { query } = useFollowRequests();
  const count = query.data?.length ?? 0;
  const value = query.isLoading
    ? "Loading…"
    : query.isError
      ? "Check requests"
      : `${count} pending`;

  return (
    <SettingsListItem
      icon={<UserCheck size={22} color="#666" />}
      label="Follow requests"
      value={value}
      onPress={() => router.push("/settings/privacy" as any)}
    />
  );
}
