// OCR Scanner disabled - react-native-vision-camera-text-recognition removed due to GoogleMLKit version conflict
// See CLAUDE.md for details. TODO: Re-add OCR when compatible version is available
import {
  Camera,
  type CameraRef,
  useCameraDevice,
} from "react-native-vision-camera";
import { StyleSheet } from "react-native";

type Block = {
  text: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export function OCRScanner({
  onResult,
  cameraRef,
  isActive,
}: {
  onResult: (blocks: Block[]) => void;
  cameraRef: React.RefObject<CameraRef | null>;
  isActive: boolean;
}) {
  const device = useCameraDevice("back");

  // OCR functionality disabled - package removed due to GoogleMLKit conflicts
  // The camera still renders but doesn't process text

  if (!device) return null;

  return (
    <Camera
      ref={cameraRef}
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={isActive}
    />
  );
}
