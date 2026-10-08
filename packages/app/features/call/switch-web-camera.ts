/**
 * Camera switching for ordinary Fishjam web calls (not Sneaky Lynk/MoQ).
 * Fishjam's cameraDevices can be stale after permission is granted on mobile.
 * Enumerate the live browser devices and pick the opposite-facing camera.
 */
export interface CallCameraDevice { deviceId: string; label?: string }

function facing(label = ""): "front" | "back" | null {
  if (/back|rear|environment|world|traseira|trasera|rückseite/i.test(label)) return "back";
  if (/front|user|face|selfie|frontal|facetime/i.test(label)) return "front";
  return null;
}

export function chooseNextCallCamera(
  devices: CallCameraDevice[],
  currentDeviceId?: string,
): CallCameraDevice | null {
  const unique = [...new Map(
    devices.filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d) => [d.deviceId, d]),
  ).values()];
  if (unique.length < 2) return null;

  const current = unique.find((d) => d.deviceId === currentDeviceId);
  const currentIndex = unique.findIndex((d) => d.deviceId === currentDeviceId);
  const opposite = facing(current?.label) === "front" ? "back" :
    facing(current?.label) === "back" ? "front" : null;
  const nextFacing = opposite
    ? unique.find((d) => d.deviceId !== currentDeviceId && facing(d.label) === opposite)
    : undefined;
  return nextFacing ?? unique[(Math.max(-1, currentIndex) + 1) % unique.length];
}

export async function switchWebCallCamera(camera: {
  cameraDevices?: CallCameraDevice[];
  currentCamera?: CallCameraDevice | null;
  selectCamera: (deviceId: string) => Promise<unknown>;
}): Promise<boolean> {
  // The SDK list sometimes reflects permissions from before getUserMedia.
  const listed = camera.cameraDevices ?? [];
  let browserDevices: CallCameraDevice[] = [];
  if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
    try {
      browserDevices = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label }));
    } catch {
      // Use the SDK's current list when the browser refuses enumeration.
    }
  }
  const devices = [...browserDevices, ...listed].filter(
    (d, i, arr) => arr.findIndex((entry) => entry.deviceId === d.deviceId) === i,
  );
  const next = chooseNextCallCamera(devices, camera.currentCamera?.deviceId);
  if (!next) return false;
  await camera.selectCamera(next.deviceId);
  return true;
}
