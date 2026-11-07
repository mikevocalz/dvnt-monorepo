"use client";

import { useCallback } from "react";
import { EyeOff, Mic, MicOff, Radio, Video, VideoOff } from "lucide-react";
import { useCameraPreview } from "../../hooks/useCameraPreview.web";
import { useRoomUIStore } from "../../stores/room-ui-store";

export function PreJoinSetup({ roomTitle, roomHasVideo, onJoin }: {
  roomTitle: string;
  roomHasVideo: boolean;
  /** Preparation runs only after the account gate allows this exact entry. */
  onJoin: (anonymous: boolean, prepareJoin: () => void) => void;
}) {
  const anonymous = useRoomUIStore(s => s.joinAnonymous);
  const cameraOn = useRoomUIStore(s => s.joinCameraOn);
  const micOn = useRoomUIStore(s => s.joinMicOn);
  const preview = useCameraPreview(roomHasVideo && cameraOn);
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
      state.setJoinCameraOn(reviewedCamera && state.joinCameraOn && preview.isReady());
      preview.stop();
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
        <p className="mt-3 text-xs leading-5 text-white/60">{micOn ? "Your microphone will turn on when you join, if your room role allows it. It isn't being tested here." : "You'll join muted. You can unmute in the room if your role allows it."}</p>
        {roomHasVideo && cameraOn && preview.state === "error" ? <div role="alert" className="mt-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-100">
          <p>{preview.message}</p>
          <button type="button" onClick={preview.retry} className={`mt-2 min-h-11 rounded-lg bg-white/10 px-4 font-semibold ${focus}`}>Retry camera</button>
        </div> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-5">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-3"><EyeOff size={20} className="shrink-0 text-[#FC253A]" aria-hidden="true" /><span><span className="block font-semibold">Join Anonymously</span><span className="mt-1 block text-xs leading-5 text-white/60">You'll appear as &quot;Anon&quot; with no profile info</span></span></span>
            <button type="button" role="switch" aria-label="Join anonymously" aria-checked={anonymous}
              onClick={() => useRoomUIStore.getState().setJoinAnonymous(!anonymous)} className={`flex h-11 w-12 shrink-0 items-center rounded-xl ${focus}`}>
              <span aria-hidden="true" className={`relative h-7 w-12 rounded-full ${anonymous ? "bg-[#FC253A]" : "bg-white/20"}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform motion-reduce:transition-none ${anonymous ? "translate-x-5" : "translate-x-0"}`} /></span>
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 p-5">
          <p className="mb-2 font-semibold">Room Safety</p>
          <p className="text-xs leading-5 text-white/60">By joining, you agree to DVNT community guidelines. Recording is prohibited, screenshots may notify the room, and participants can report unsafe behavior.</p>
        </div>
        <div aria-live="polite" className="text-sm text-white/70">
          <p>{roomHasVideo ? cameraReady ? "Camera ready" : "You'll join with your camera off" : "Camera off for this audio room"}</p>
          <p>{micOn ? "Microphone on when you join" : "Microphone muted"}{anonymous ? " · Anonymous" : " · Your profile"}</p>
        </div>
        <button type="button" onClick={join} className={`min-h-12 w-full rounded-xl bg-[#FC253A] px-4 py-3 font-bold text-white hover:brightness-110 ${focus}`}>
          {anonymous ? "Join Anonymously" : "Join Lynk"}
        </button>
      </div>
    </section>
  );
}
