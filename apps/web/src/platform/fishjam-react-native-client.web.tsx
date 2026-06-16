'use client';

import React, { useEffect, useRef } from 'react';
import { FishjamProvider, useCamera, useConnection, useCustomSource, useDataChannel, useInitializeDevices, useLivestreamStreamer, useLivestreamViewer, useMicrophone, usePeers, useSandbox, useScreenShare, useUpdatePeerMetadata, useVAD, Variant } from '@fishjam-cloud/react-client';

type RTCViewProps = {
  mediaStream?: MediaStream | null;
  stream?: MediaStream | null;
  objectFit?: React.CSSProperties['objectFit'];
  mirror?: boolean;
  style?: React.CSSProperties;
};

export function RTCView({ mediaStream, stream, objectFit = 'cover', mirror, style }: RTCViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resolvedStream = mediaStream ?? stream ?? null;

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = resolvedStream;
    videoRef.current.play().catch(() => undefined);
  }, [resolvedStream]);

  return (
    <video
      autoPlay
      muted
      playsInline
      ref={videoRef}
      style={{
        height: '100%',
        objectFit,
        transform: mirror ? 'scaleX(-1)' : undefined,
        width: '100%',
        ...(style as React.CSSProperties),
      }}
    />
  );
}

export const RTCPIPView = RTCView;
export const startPIP = async () => {};
export const stopPIP = async () => {};
export const useForegroundService = () => ({});
export const useCameraPermissions = () => ({ status: 'granted', requestPermission: async () => true });
export const useMicrophonePermissions = () => ({ status: 'granted', requestPermission: async () => true });
export const useAudioOutput = () => ({ devices: [], selectedDevice: null, selectAudioOutput: async () => {} });
export const AudioDeviceType = {};

export {
  FishjamProvider,
  useCamera,
  useConnection,
  useCustomSource,
  useDataChannel,
  useInitializeDevices,
  useLivestreamStreamer,
  useLivestreamViewer,
  useMicrophone,
  usePeers,
  useSandbox,
  useScreenShare,
  useUpdatePeerMetadata,
  useVAD,
  Variant,
};
