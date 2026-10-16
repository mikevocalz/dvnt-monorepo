/** Real Fishjam hooks with only the browser devices and SFU transport faked. */
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { FishjamProvider, useCamera, useMicrophone, useConnection } from "@fishjam-cloud/react-client";
import { stopWebCallMedia } from "../../packages/app/features/call/stop-web-call-media";
import { switchWebCallCamera } from "../../packages/app/features/call/switch-web-camera";

const check = (condition: unknown, description: string) => {
  if (!condition) throw new Error(description);
};
class Track extends EventTarget {
  id: string;
  enabled = true;
  readyState = "live";
  constructor(public kind: string, public deviceId: string) { super(); this.id = `${kind}-${deviceId}`; }
  getSettings() { return { deviceId: this.deviceId }; }
  stop() { this.enabled = false; this.readyState = "ended"; }
}
class Stream {
  constructor(private tracks: Track[]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === "video"); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === "audio"); }
}
class Client {
  listeners = new Map<string, Set<(...args: any[]) => void>>();
  tracks = new Map<string, any>();
  published: Track[] = [];
  replaced: (Track | null)[] = [];
  leaves = 0;
  status = "initialized";
  on(name: string, fn: (...args: any[]) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(fn);
  }
  off(name: string, fn: (...args: any[]) => void) { this.listeners.get(name)?.delete(fn); }
  removeListener(name: string, fn: (...args: any[]) => void) { this.off(name, fn); }
  emit(name: string) { for (const fn of this.listeners.get(name) ?? []) fn(); }
  getLocalPeer() { return { id: "fixture-peer", metadata: {}, tracks: this.tracks }; }
  getRemotePeers() { return new Map(); }
  getRemoteComponents() { return new Map(); }
  isReconnecting() { return false; }
  connect() { this.emit("connectionStarted"); }
  disconnect() { this.leaves++; this.tracks.clear(); this.emit("disconnected"); }
  async addTrack(track: Track, metadata: any) {
    const trackId = `published-${this.published.length}`;
    this.published.push(track);
    this.tracks.set(trackId, { trackId, track, metadata });
    this.emit("localTrackAdded");
    return trackId;
  }
  async replaceTrack(id: string, track: Track | null) {
    this.replaced.push(track);
    this.tracks.get(id).track = track;
    this.emit("localTrackReplaced");
  }
  updateTrackMetadata(id: string, metadata: any) { this.tracks.get(id).metadata = metadata; }
}

(window as any).runWebCallSdkTests = async () => {
  (window as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).MediaStream = Stream;
  const requests: { resolve: (value: Stream) => void; reject: (error: Error) => void }[] = [];
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: () => new Promise<Stream>((resolve, reject) => requests.push({ resolve, reject })),
    enumerateDevices: async () => [
      { kind: "videoinput", deviceId: "front", label: "Front Camera" },
      { kind: "videoinput", deviceId: "back", label: "Back Camera" },
    ],
  } });
  const client = new Client();
  let api: { camera: ReturnType<typeof useCamera>; microphone: ReturnType<typeof useMicrophone>; connection: ReturnType<typeof useConnection> };
  function Hooks() {
    api = { camera: useCamera(), microphone: useMicrophone(), connection: useConnection() };
    useEffect(() => () => stopWebCallMedia(api.connection.leaveRoom, api.camera, api.microphone), []);
    return null;
  }
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<FishjamProvider fishjamClient={client as any} fishjamId="fixture" persistLastDevice={false}><Hooks /></FishjamProvider>));
  const cases: string[] = [];
  try {
    // Reproduces upstream #612: camera acquisition finishes after joined fired.
    let cameraJob: Promise<unknown>;
    await act(async () => {
      client.connect();
      cameraJob = api.camera.toggleCamera();
      await Promise.resolve();
      await Promise.resolve();
    });
    check(requests.length === 1, "camera acquisition is pending");
    await act(async () => client.emit("joined"));
    const camera = new Track("video", "front");
    await act(async () => { requests.shift()!.resolve(new Stream([camera])); await cameraJob; });
    check(client.published.filter(track => track === camera).length === 1, "camera acquired during join is published exactly once");
    check(api.camera.isCameraOn, "real camera hook exposes the acquired stream");
    cases.push("camera acquisition during joining publishes once");

    let micJob: Promise<unknown>;
    await act(async () => { micJob = api.microphone.toggleMicrophone(); await Promise.resolve(); await Promise.resolve(); });
    const mic = new Track("audio", "first-mic");
    await act(async () => { requests.shift()!.resolve(new Stream([mic])); await micJob; });
    check(api.microphone.isMicrophoneOn, "microphone started");

    // Reproduces #611: device selection captured unmuted state before its await.
    let switchJob: Promise<unknown>;
    await act(async () => { switchJob = api.microphone.selectMicrophone("second-mic"); await Promise.resolve(); await Promise.resolve(); });
    check(requests.length === 1, "replacement microphone acquisition is pending");
    await act(async () => api.microphone.toggleMicrophoneMute());
    check(!mic.enabled && api.microphone.isMicrophoneMuted, "mute takes effect while switching");
    const replacement = new Track("audio", "second-mic");
    await act(async () => { requests.shift()!.resolve(new Stream([replacement])); await switchJob; });
    check(!replacement.enabled, "new microphone preserves the latest mute choice");
    check(mic.readyState === "ended", "replaced microphone track is released");
    await act(async () => api.microphone.toggleMicrophoneMute());
    check(replacement.enabled && !api.microphone.isMicrophoneMuted, "unmute resumes the new microphone");
    cases.push("mute during microphone switching survives acquisition and unmutes");

    let flipJob: Promise<unknown>;
    let flipError: any;
    await act(async () => {
      flipJob = switchWebCallCamera({ ...api.camera, currentCamera: { deviceId: "front" } }).catch(error => { flipError = error; });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    check(requests.length === 1, "opposite-facing camera acquisition was requested");
    await act(async () => { requests.shift()!.reject(new DOMException("Denied", "NotAllowedError")); await flipJob; });
    check(flipError?.name === "NotAllowedError", "Fishjam resolved device errors propagate from camera switching");
    check(camera.readyState === "live", "failed camera switching preserves the active camera");
    cases.push("camera permission denial reports failure and retains current camera");

    await act(async () => api.camera.toggleCamera());
    check(camera.readyState === "ended" && !api.camera.isCameraOn, "camera off releases capture");
    await act(async () => { cameraJob = api.camera.toggleCamera(); await Promise.resolve(); await Promise.resolve(); });
    const restarted = new Track("video", "front-restarted");
    await act(async () => { requests.shift()!.resolve(new Stream([restarted])); await cameraJob; });
    check(api.camera.isCameraOn && client.replaced.includes(restarted), "camera on resumes the existing published track");
    cases.push("camera off and on releases then republishes capture");

    await act(async () => root.unmount());
    check(client.leaves === 1, "navigation cleanup disconnects Fishjam");
    check(restarted.readyState === "ended" && replacement.readyState === "ended", "navigation cleanup releases camera and microphone tracks");
    check([...client.listeners.values()].every(listeners => listeners.size === 0), "SDK listeners are removed on unmount");
    cases.push("navigation cleanup stops both devices and removes SDK listeners");
    const remount = createRoot(document.getElementById("root")!);
    await act(async () => remount.render(<FishjamProvider fishjamClient={client as any} fishjamId="fixture" persistLastDevice={false}><Hooks /></FishjamProvider>));
    let stoppedStart: Promise<unknown>;
    await act(async () => { stoppedStart = api.camera.toggleCamera(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => api.camera.stopCamera());
    const cancelledCamera = new Track("video", "stopped-before-ready");
    await act(async () => { requests.shift()!.resolve(new Stream([cancelledCamera])); await stoppedStart; });
    check(cancelledCamera.readyState === "ended" && !api.camera.isCameraOn, "stopCamera cancels capture that is still pending");
    cases.push("explicit camera stop cancels a pending acquisition");

    let oldStart: Promise<unknown>, newStart: Promise<unknown>;
    await act(async () => { oldStart = api.camera.startCamera("old"); await Promise.resolve(); });
    await act(async () => { newStart = api.camera.startCamera("new"); await Promise.resolve(); });
    const oldRequest = requests.shift()!, newRequest = requests.shift()!;
    const oldTrack = new Track("video", "old"), newTrack = new Track("video", "new");
    await act(async () => { newRequest.resolve(new Stream([newTrack])); await newStart; });
    await act(async () => { oldRequest.resolve(new Stream([oldTrack])); await oldStart; });
    check(oldTrack.readyState === "ended" && newTrack.readyState === "live", "superseded acquisition cannot replace or stop the newer camera");
    check(api.camera.cameraStream?.getTracks()[0] === (newTrack as unknown as MediaStreamTrack), "the latest requested camera stays selected");
    cases.push("out-of-order device acquisition preserves the newest camera");
    let failedOldStart: Promise<unknown>, successfulNewStart: Promise<unknown>;
    await act(async () => { failedOldStart = api.camera.startCamera("old-failure"); await Promise.resolve(); });
    await act(async () => { successfulNewStart = api.camera.startCamera("new-success"); await Promise.resolve(); });
    const failedOldRequest = requests.shift()!, successfulNewRequest = requests.shift()!;
    const latestTrack = new Track("video", "new-success");
    await act(async () => { successfulNewRequest.resolve(new Stream([latestTrack])); await successfulNewStart; });
    await act(async () => { failedOldRequest.reject(new DOMException("Old permission denied", "NotAllowedError")); await failedOldStart; });
    check(api.camera.cameraDeviceError === null && latestTrack.readyState === "live", "an old rejected request cannot overwrite the current camera status");
    cases.push("superseded permission rejection cannot poison a newer successful camera");
    await act(async () => api.camera.stopCamera());

    let pendingOnLeave: Promise<unknown>, microphoneOnLeave: Promise<unknown>;
    await act(async () => { pendingOnLeave = api.camera.toggleCamera(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { microphoneOnLeave = api.microphone.toggleMicrophone(); await Promise.resolve(); await Promise.resolve(); });
    check(requests.length === 2, "camera and microphone permission requests are pending at navigation");
    await act(async () => remount.unmount());
    const lateCamera = new Track("video", "late-after-navigation");
    await act(async () => { requests.shift()!.resolve(new Stream([lateCamera])); await pendingOnLeave; });
    const lateMicrophone = new Track("audio", "late-audio-after-navigation");
    await act(async () => { requests.shift()!.resolve(new Stream([lateMicrophone])); await microphoneOnLeave; });
    check(lateCamera.readyState === "ended" && lateMicrophone.readyState === "ended", "late permission results cannot keep recording after navigation");
    cases.push("late camera and microphone acquisition after unmount is immediately released");
    return cases;
  } catch (error) {
    await act(async () => root.unmount());
    throw error;
  }
};
