'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

type CameraPermissionStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';

type CameraProps = {
  isActive?: boolean;
  device?: { position?: 'front' | 'back'; id?: string };
  style?: React.CSSProperties;
};

async function requestMediaPermission(constraints: MediaStreamConstraints) {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

export const Camera = forwardRef(function Camera(
  { isActive = true, device, style }: CameraProps,
  ref,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useImperativeHandle(ref, () => ({
    takePhoto: async () => ({ path: '' }),
    startRecording: () => {},
    stopRecording: async () => {},
  }));

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!isActive || !navigator.mediaDevices?.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: device?.position === 'front' ? 'user' : 'environment',
        },
        audio: false,
      });
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    }
    start().catch(() => undefined);
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [device?.position, isActive]);

  return (
    <video
      autoPlay
      muted
      playsInline
      ref={videoRef}
      style={{
        height: '100%',
        objectFit: 'cover',
        width: '100%',
        ...(style as React.CSSProperties),
      }}
    />
  );
});

export const VisionCamera = {
  get cameraPermissionStatus(): CameraPermissionStatus {
    return 'not-determined';
  },
  get microphonePermissionStatus(): CameraPermissionStatus {
    return 'not-determined';
  },
  requestCameraPermission: async () =>
    (await requestMediaPermission({ video: true })) ? 'granted' : 'denied',
  requestMicrophonePermission: async () =>
    (await requestMediaPermission({ audio: true })) ? 'granted' : 'denied',
};

export type CameraRef = React.ElementRef<typeof Camera>;
export type Recorder = unknown;

export function useCameraDevice(position: 'front' | 'back') {
  return { id: position, position };
}

export function useCameraPermission() {
  return {
    hasPermission: true,
    requestPermission: async () => requestMediaPermission({ video: true }),
  };
}

export function useMicrophonePermission() {
  return {
    hasPermission: true,
    requestPermission: async () => requestMediaPermission({ audio: true }),
  };
}

export function usePhotoOutput() {
  return undefined;
}

export function useVideoOutput() {
  return undefined;
}
