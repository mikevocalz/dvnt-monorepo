import { useEffect } from "react";
import { useRoomUIStore } from "../stores/room-ui-store";

/** Keep output device hotplug handling alive even with room settings closed. */
export function useRoomAudioOutput() {
  const output = useRoomUIStore(state => state.audioOutput);
  useEffect(() => output.connect(), [output]);
  return output;
}
