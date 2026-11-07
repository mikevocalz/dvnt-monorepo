"use client";
import { useEffect, useId, useRef } from "react";
import { useRoomAudioOutput } from "../../hooks/use-room-audio-output.web";
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
  const container = useRef<HTMLDivElement>(null);
  const output = useRoomAudioOutput();
  const speaker = useRoomUIStore(state => state.audioOutputState);
  useEffect(() => {
    const details = container.current?.closest("details");
    const close = () => { if (!details?.open) output.cancelPicker(); };
    details?.addEventListener("toggle", close);
    return () => { details?.removeEventListener("toggle", close); output.cancelPicker(); };
  }, [output]);
  const selectedOutputMissing = speaker.deviceId && !speaker.devices.some(device => device.deviceId === speaker.deviceId);
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
  return <div ref={container} className="grid min-w-0 gap-4" data-device-selectors>
    {roomHasVideo ? select("videoinput", "Camera", cameraId, useRoomUIStore.getState().setCameraDeviceId) : null}
    {select("audioinput", "Microphone", microphoneId, useRoomUIStore.getState().setMicrophoneDeviceId)}
    <p className="text-xs leading-5 text-white/60">Device names may appear after you allow access. Choosing a device won't turn it on.</p>
    {error ? <p role="status" className="text-xs text-amber-200">{error}</p> : null}
    <button type="button" onClick={() => { refresh(); void output.refresh(); }} className={`min-h-11 justify-self-start rounded-lg bg-white/10 px-3 text-sm ${focus}`}>Refresh devices</button>
    <div className="min-w-0 border-t border-white/10 pt-4" data-speaker-settings>
      <label htmlFor={speaker.supported ? `${id}-audiooutput` : undefined} className="mb-1.5 block text-sm font-semibold">Speakers or headphones</label>
      {speaker.supported ? <>
        <select id={`${id}-audiooutput`} value={speaker.deviceId} disabled={speaker.choosing}
          aria-describedby={`${id}-output-status`} aria-busy={speaker.phase === "applying" || speaker.choosing}
          onChange={event => output.select(event.target.value, speaker.devices.find(device => device.deviceId === event.target.value)?.label || "Selected speaker or headphones")}
          className={`min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-[#111522] px-3 text-sm text-white disabled:opacity-50 ${focus}`}>
          <option value="">System default</option>
          {selectedOutputMissing ? <option value={speaker.deviceId}>{speaker.label}</option> : null}
          {speaker.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker or headphones ${index + 1}`}</option>)}
        </select>
        <div className="mt-2 flex flex-wrap gap-2">
          {speaker.canChoose ? <button type="button" disabled={speaker.choosing} onClick={() => { void output.choose(); }}
            className={`min-h-11 rounded-lg bg-white/10 px-3 text-sm disabled:opacity-50 ${focus}`}>{speaker.choosing ? "Waiting for speaker choice…" : "Choose speaker or headphones"}</button> : null}
          {speaker.deviceId || speaker.phase === "error" || speaker.choosing ? <button type="button" onClick={() => output.select("", "System default")}
            className={`min-h-11 rounded-lg bg-white/10 px-3 text-sm ${focus}`}>Use system default</button> : null}
        </div>
        <p id={`${id}-output-status`} role="status" aria-live="polite" className={`mt-2 text-xs leading-5 ${speaker.message ? "text-amber-200" : "text-white/60"}`}>
          {speaker.message || (speaker.choosing ? "Choose an output in the browser prompt. Your microphone and camera stay unchanged." : speaker.phase === "applying" ? "Switching room audio…" : speaker.phase === "waiting" ? `${speaker.label} is selected. Routing will be checked when room audio starts.` : speaker.phase === "ready" ? `Room audio is routed to ${speaker.label}.` : "Room audio follows your system default output.")}
        </p>
        {!speaker.canChoose ? <p className="mt-1 text-xs leading-5 text-white/60">Only outputs already available to this browser are listed. If yours is missing, use your system sound settings.</p> : null}
      </> : <p id={`${id}-output-status`} className="text-xs leading-5 text-white/60">This browser can't route Lynk's audio to a specific speaker. Choose speakers or headphones in your system sound settings.</p>}
    </div>
  </div>;
}
