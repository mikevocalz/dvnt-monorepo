"use client";

import { useCallback } from "react";
import { EyeOff, Mic, MicOff, Radio, Video, VideoOff } from "lucide-react";
import { useCameraPreview } from "../../hooks/useCameraPreview.web";
import { DeviceSelectors } from "./DeviceSelectors";
import { useMicrophoneTest } from "../../hooks/use-microphone-test.web";
import { useRoomUIStore } from "../../stores/room-ui-store";
import type { RoomEntryIdentity } from "../../api/room-entry-identity";

export function PreJoinSetup({ roomTitle, roomHasVideo, identity, onJoin }: {
  roomTitle: string;
  roomHasVideo: boolean;
  identity?: RoomEntryIdentity;
  /** Preparation runs only after the account gate allows this exact entry. */
  onJoin: (anonymous: boolean, prepareJoin: () => void) => void;
}) {
  const anonymousChoice = useRoomUIStore(s => s.joinAnonymous);
  const anonymous = identity?.kind === "active" ? identity.anonymous : anonymousChoice;
  const cameraOn = useRoomUIStore(s => s.joinCameraOn);
  const micOn = useRoomUIStore(s => s.joinMicOn);
  const cameraDeviceId = useRoomUIStore(s => s.cameraDeviceId);
  const microphoneDeviceId = useRoomUIStore(s => s.microphoneDeviceId);
  const microphoneTest = useMicrophoneTest(microphoneDeviceId, micOn);
  const preview = useCameraPreview(roomHasVideo && cameraOn, cameraDeviceId);
  const bindPreview = useCallback((element: HTMLVideoElement | null) => {
    if (element) element.srcObject = preview.stream;
  }, [preview.stream]);
  const cameraReady = roomHasVideo && cameraOn && preview.state === "ready";
  const join = () => {
    // Freeze what the person reviewed. An unfinished/failed preview never
    // silently becomes a live camera after the account prompt is dismissed.
    const reviewedCamera = cameraReady;
    onJoin(anonymous, () => {
      const state = useRoomUIStore.getState();
      state.setJoinCameraOn(reviewedCamera && state.joinCameraOn && state.cameraDeviceId === cameraDeviceId && preview.isReady());
      preview.stop();
      microphoneTest.stop();
    });
  };
  const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF] focus-visible:outline-offset-2";
  return (
    <section aria-label="Set up your Lynk" className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-6 px-4 py-6 sm:px-8 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,1fr)] lg:items-center lg:gap-10"
      style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
      <div className="min-w-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#3FDCFF]">Before you join</p>
        <h1 className="break-words text-2xl font-bold sm:text-3xl">{roomTitle || "Sneaky Lynk"}</h1>
        <p className="mb-5 mt-2 text-sm text-white/60">{roomHasVideo ? "Check your camera and choose how you arrive." : "An audio-only room. Your camera stays off."}</p>
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
          <div className="relative aspect-video w-full">
            {cameraReady && preview.stream ? <video ref={bindPreview} autoPlay playsInline muted aria-label="Your camera preview"
              className="absolute inset-0 h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} /> :
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/60">
                {roomHasVideo ? <VideoOff size={28} aria-hidden="true" /> : <Radio size={28} aria-hidden="true" />}
                <span className="text-sm" role="status">{!roomHasVideo ? "Audio-only Lynk" : !cameraOn ? "Camera off" : preview.state === "requesting" ? "Waiting for your camera…" : "Camera unavailable"}</span>
              </div>}
            <span className="absolute bottom-3 left-3 rounded-lg bg-black/70 px-3 py-1.5 text-xs text-white">Only you can see this preview</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 p-3">
            {roomHasVideo ? <button type="button" aria-pressed={cameraOn} onClick={() => useRoomUIStore.getState().setJoinCameraOn(!cameraOn)}
              className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${focus} ${cameraOn ? "bg-white/10 hover:bg-white/15" : "bg-[#FC253A]/20 text-rose-200"}`}
              aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}>
              {cameraOn ? <Video size={18} aria-hidden="true" /> : <VideoOff size={18} aria-hidden="true" />}{cameraOn ? cameraReady ? "Camera on" : preview.state === "requesting" ? "Starting camera" : "Camera unavailable" : "Camera off"}
            </button> : null}
            <button type="button" aria-pressed={micOn} onClick={() => useRoomUIStore.getState().setJoinMicOn(!micOn)}
              className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold ${focus} ${micOn ? "bg-white/10 hover:bg-white/15" : "bg-[#FC253A]/20 text-rose-200"}`}
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}>
              {micOn ? <Mic size={18} aria-hidden="true" /> : <MicOff size={18} aria-hidden="true" />}Mic {micOn ? "on" : "off"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-white/60">{microphoneTest.testing ? "Your microphone test is running on this device only. Close device settings to stop it." : micOn ? "Your microphone will turn on when you join, if your room role allows it. You can test it in device settings below." : "You'll join muted. You can unmute in the room if your role allows it."}</p>
        <details onToggle={event => { if (!event.currentTarget.open) microphoneTest.stop(); }} className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <summary className={`flex min-h-11 cursor-pointer items-center text-sm font-semibold ${focus}`}>Audio &amp; camera settings</summary>
          <div className="mt-3 grid gap-4">
            <DeviceSelectors roomHasVideo={roomHasVideo} refreshKey={`${preview.state}:${microphoneTest.state}`} />
            <div className="border-t border-white/10 pt-4">
              <button type="button" disabled={!micOn} onClick={microphoneTest.testing ? microphoneTest.stop : microphoneTest.start}
                className={`min-h-11 rounded-lg bg-white/10 px-4 text-sm font-semibold disabled:opacity-40 ${focus}`}>
                {microphoneTest.testing ? "Stop microphone test" : "Test microphone"}
              </button>
              <p className="mt-2 text-xs leading-5 text-white/60">The test stays on this device. Nothing is recorded or sent to the room.</p>
              {microphoneTest.testing ? <div className="mt-3">
                <meter min={0} max={1} value={microphoneTest.level} aria-label="Microphone input level" className="h-3 w-full accent-[#3FDCFF]" />
                <p role="status" className="mt-1 text-xs text-white/70">{microphoneTest.state === "requesting" ? "Waiting for microphone access…" : microphoneTest.state === "ready" ? "Speak to check your microphone level." : "Microphone unavailable"}</p>
              </div> : null}
              {microphoneTest.message ? <p role="status" className="mt-2 text-xs text-amber-200">{microphoneTest.message}</p> : null}
            </div>
          </div>
        </details>
        {roomHasVideo && cameraOn && preview.state === "error" ? <div role="alert" className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
          <p>{preview.message}</p>
          <button type="button" onClick={preview.retry} className={`mt-2 min-h-11 rounded-lg bg-white/10 px-4 font-semibold ${focus}`}>Retry camera</button>
        </div> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {identity?.kind === "active" ? <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5" role="status">
          <p className="font-semibold">{anonymous ? `Rejoining as ${identity.anonLabel || "Anon"}` : "Rejoining with your profile"}</p>
          <p className="mt-2 text-xs leading-5 text-white/60">Your identity stays the same while your room membership is active. Your camera and microphone choices are yours.</p>
          <p className="mt-2 text-xs leading-5 text-white/60">Going back does not end this Lynk or remove your existing membership. This device shares media only after you join.</p>
        </div> : <>
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-3"><EyeOff size={20} className="shrink-0 text-[#FC253A]" aria-hidden="true" /><span><span className="block font-semibold">Join Anonymously</span><span className="mt-1 block text-xs leading-5 text-white/60">Your name and profile photo stay hidden in this room.</span></span></span>
            <button type="button" role="switch" aria-label="Join anonymously" aria-checked={anonymous}
              onClick={() => useRoomUIStore.getState().setJoinAnonymous(!anonymous)} className={`flex h-11 w-12 shrink-0 items-center rounded-xl ${focus}`}>
              <span aria-hidden="true" className={`relative h-7 w-12 rounded-full ${anonymous ? "bg-[#FC253A]" : "bg-white/20"}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${anonymous ? "translate-x-5" : "translate-x-0"}`} /></span>
            </button>
          </div>
        </div>
        </>}
        <div className="rounded-2xl border border-white/10 p-5">
          <p className="mb-2 font-semibold">Your privacy, your choice</p>
          <p className="text-xs leading-5 text-white/60">Anonymous mode hides your profile, not your voice, camera or what you share. Recording is prohibited, but no room can prevent someone using another device to capture it.</p>
          <p className="mt-2 text-xs leading-5 text-white/60">By joining, you agree to DVNT community guidelines. Some screenshot attempts may notify the room.</p>
        </div>
        <div aria-live="polite" className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/70">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-white/50">Your arrival</p>
          <p className="flex items-center gap-2">{cameraReady ? <Video size={16} aria-hidden="true" /> : <VideoOff size={16} aria-hidden="true" />}{roomHasVideo ? cameraReady ? "Camera ready" : "You'll join with your camera off" : "Camera off for this audio room"}</p>
          <p className="mt-1 flex items-center gap-2">{micOn ? <Mic size={16} aria-hidden="true" /> : <MicOff size={16} aria-hidden="true" />}{micOn ? "Mic on if your room role allows it" : "Microphone muted"}</p>
          <p className="mt-2 border-t border-white/8 pt-2 text-xs text-white/60">{anonymous ? "You'll appear as Anon" : "You'll join with your profile"}</p>
        </div>
        <button type="button" onClick={join} className={`min-h-12 w-full rounded-xl bg-[#FC253A] px-4 py-3 font-bold text-white hover:brightness-110 ${focus}`}>
          {anonymous ? "Join Anonymously" : "Join Lynk"}
        </button>
      </div>
    </section>
  );
}
