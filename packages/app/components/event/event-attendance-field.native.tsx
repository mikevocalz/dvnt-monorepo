import { Switch, Text, View } from "react-native";
import { isSensitiveAttendanceEvent } from "@dvnt/app/lib/events/event-attendee-visibility";
import {
  EVENT_ATTENDANCE_HELP,
  EVENT_ATTENDANCE_LABEL,
  type EventAttendanceFieldProps,
} from "./event-attendance-field.types";

export function EventAttendanceField(props: EventAttendanceFieldProps) {
  if (!isSensitiveAttendanceEvent(props)) return null;
  return (
    <View className="mt-3 flex-row items-center justify-between gap-3 rounded-2xl bg-card p-4">
      <View className="flex-1">
        <Text className="text-sm font-semibold text-foreground">{EVENT_ATTENDANCE_LABEL}</Text>
        <Text className="mt-1 text-xs text-muted-foreground">{EVENT_ATTENDANCE_HELP}</Text>
      </View>
      <Switch
        value={props.showAttendees === true}
        onValueChange={props.onChange}
        accessibilityLabel={EVENT_ATTENDANCE_LABEL}
        accessibilityHint={EVENT_ATTENDANCE_HELP}
        trackColor={{ false: "#333", true: "#3FDCFF" }}
        thumbColor="#fff"
      />
    </View>
  );
}
