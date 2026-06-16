export const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
export const MediaStream = globalThis.MediaStream;
export const MediaStreamTrack = globalThis.MediaStreamTrack;
export const RTCPeerConnection = globalThis.RTCPeerConnection;
export const RTCIceCandidate = globalThis.RTCIceCandidate;
export const RTCSessionDescription = globalThis.RTCSessionDescription;

export const RTCAudioSession = {
  audioSessionDidActivate: () => {},
  audioSessionDidDeactivate: () => {},
};

export const ScreenCapturePickerView = () => null;
export const startPIP = async () => {};
export const stopPIP = async () => {};
export const AudioDeviceType = {};
export const useAudioOutput = () => ({
  devices: [],
  selectedDevice: null,
  selectAudioOutput: async () => {},
});

export default {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
};
