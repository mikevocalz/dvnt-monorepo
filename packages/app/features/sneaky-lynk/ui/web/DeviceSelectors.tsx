"use client";
import { useId } from "react";
import { useMediaDevices } from "../../hooks/use-media-devices.web";
import { useRoomUIStore } from "../../stores/room-ui-store";

const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF] focus-visible:outline-offset-2";

/** Selection changes intent only. The preview/publisher owns capture and its
 * permission/role gates; choosing hardware must never unmute or enable it. */
export function DeviceSelectors({ roomHasVideo, refreshKey }: { roomHasVideo: boolean; refreshKey?: unknown }) {
  const cameraId = useRoomUIStore(s => s.cameraDeviceId);
  const microphoneId = useRoomUIStore(s => s.microphoneDeviceId);
  const { devices, error, refresh } = useMediaDevices(refreshKey);
  const id = useId();
  const select = (kind: MediaDeviceKind, label: string, selected: string, onChange: (id: string) => void) => {
    const choices = devices.filter(device => device.kind === kind && device.deviceId && device.deviceId !== "default");
    const missing = selected && !choices.some(device => device.deviceId === selected);
    return <div>
      <label htmlFor={`${id}-${kind}`} className="mb-1.5 block text-sm font-semibold">{label}</label>
      <select id={`${id}-${kind}`} value={selected} onChange={event => onChange(event.target.value)}
        className={`min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-[#111522] px-3 text-sm text-white ${focus}`}>
        <option value="">System default {label.toLowerCase()}</option>
        {missing ? <option value={selected}>Selected {label.toLowerCase()} unavailable</option> : null}
        {choices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}
      </select>
      {missing ? <p className="mt-1 text-xs text-amber-200">Reconnect it or choose another {label.toLowerCase()}.</p> : null}
    </div>;
  };
  return <div className="grid min-w-0 gap-4" data-device-selectors>
    {roomHasVideo ? select("videoinput", "Camera", cameraId, useRoomUIStore.getState().setCameraDeviceId) : null}
    {select("audioinput", "Microphone", microphoneId, useRoomUIStore.getState().setMicrophoneDeviceId)}
    <p className="text-xs leading-5 text-white/60">Device names may appear after you allow access. Choosing a device won't turn it on.</p>
    {error ? <p role="status" className="text-xs text-amber-200">{error}</p> : null}
    <button type="button" onClick={refresh} className={`min-h-11 justify-self-start rounded-lg bg-white/10 px-3 text-sm ${focus}`}>Refresh devices</button>
    <p className="text-xs leading-5 text-white/60">For speakers or headphones, use your system sound settings.</p>
  </div>;
}
