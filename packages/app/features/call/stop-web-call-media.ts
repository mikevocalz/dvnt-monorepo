/** Disconnecting Fishjam does not stop browser capture devices. */
export function stopWebCallMedia(
  leaveRoom: () => void,
  camera: { stopCamera: () => void; cameraStream?: { getTracks: () => { stop: () => void }[] } | null },
  microphone: { stopMicrophone: () => void; microphoneStream?: { getTracks: () => { stop: () => void }[] } | null },
): void {
  // Capture the track references before the SDK clears its state. Teardown is
  // best-effort for each resource: a failed disconnect/camera must not leave
  // the other device recording when navigating away.
  const tracks = [...(camera.cameraStream?.getTracks() ?? []), ...(microphone.microphoneStream?.getTracks() ?? [])];
  for (const dispose of [leaveRoom, () => camera.stopCamera(), () => microphone.stopMicrophone(),
    ...tracks.map((track) => () => track.stop())]) {
    try { dispose(); } catch { /* Continue releasing the other resources. */ }
  }
}
