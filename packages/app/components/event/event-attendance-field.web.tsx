import { useId } from "react";
import { isSensitiveAttendanceEvent } from "@dvnt/app/lib/events/event-attendee-visibility";
import {
  EVENT_ATTENDANCE_HELP,
  EVENT_ATTENDANCE_LABEL,
  type EventAttendanceFieldProps,
} from "./event-attendance-field.types";

export function EventAttendanceField(props: EventAttendanceFieldProps) {
  const helpId = useId();
  if (!isSensitiveAttendanceEvent(props)) return null;
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.04] px-4 py-3">
      <span className="flex-1">
        <span className="block text-sm font-semibold text-white">{EVENT_ATTENDANCE_LABEL}</span>
        <span id={helpId} className="mt-1 block text-xs leading-4 text-white/55">{EVENT_ATTENDANCE_HELP}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={EVENT_ATTENDANCE_LABEL}
        aria-describedby={helpId}
        aria-checked={props.showAttendees === true}
        checked={props.showAttendees === true}
        onChange={(event) => props.onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 accent-[#3FDCFF]"
      />
    </label>
  );
}
