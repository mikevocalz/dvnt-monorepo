import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { useEffect, useRef, useState } from "react";
import {
  Camera,
  type CameraRef,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { Camera as CameraIcon, X } from "lucide-react-native";
import { Button } from "@dvnt/app/components/ui";
import { persistVerificationPhoto } from "@dvnt/app/lib/media";
import { useVerificationStore } from "@dvnt/app/lib/stores/useVerificationStore";
import { Canvas, Path, Line, Shadow } from "@shopify/react-native-skia";

const PURPLE = "#8A40CF";
const WHITE = "#FFFFFF";

function getFaceFrameMetrics(containerWidth: number, containerHeight: number) {
  if (containerWidth === 0 || containerHeight === 0) return null;

  const frameWidth = Math.max(188, Math.min(containerWidth - 48, 236));
  const frameHeight = Math.min(containerHeight - 72, frameWidth * 1.34);
  const offsetX = (containerWidth - frameWidth) / 2;
  const preferredTop = containerHeight * 0.11;
  const maxTop = Math.max(24, containerHeight - frameHeight - 44);
  const offsetY = Math.min(Math.max(24, preferredTop), maxTop);

  return {
    frameWidth,
    frameHeight,
    offsetX,
    offsetY,
    eyeLineY: offsetY + frameHeight * 0.32,
    chinGuideY: offsetY + frameHeight * 0.82,
  };
}

function FaceFrameOverlay({
  isScanning,
  scanProgress,
  containerWidth,
  containerHeight,
}: {
  isScanning: boolean;
  scanProgress: number;
  containerWidth: number;
  containerHeight: number;
}) {
  const metrics = getFaceFrameMetrics(containerWidth, containerHeight);
  if (!metrics) return null;

  const { frameWidth, frameHeight, offsetX, offsetY, eyeLineY, chinGuideY } =
    metrics;
  const cornerLength = 42;
  const strokeWidth = 4;
  const borderRadius = 16;
  const color = isScanning ? PURPLE : WHITE;

  const topLeftPath = `M ${offsetX},${offsetY + cornerLength} L ${offsetX},${offsetY + borderRadius} Q ${offsetX},${offsetY} ${offsetX + borderRadius},${offsetY} L ${offsetX + cornerLength},${offsetY}`;
  const topRightPath = `M ${offsetX + frameWidth - cornerLength},${offsetY} L ${offsetX + frameWidth - borderRadius},${offsetY} Q ${offsetX + frameWidth},${offsetY} ${offsetX + frameWidth},${offsetY + borderRadius} L ${offsetX + frameWidth},${offsetY + cornerLength}`;
  const bottomLeftPath = `M ${offsetX},${offsetY + frameHeight - cornerLength} L ${offsetX},${offsetY + frameHeight - borderRadius} Q ${offsetX},${offsetY + frameHeight} ${offsetX + borderRadius},${offsetY + frameHeight} L ${offsetX + cornerLength},${offsetY + frameHeight}`;
  const bottomRightPath = `M ${offsetX + frameWidth - cornerLength},${offsetY + frameHeight} L ${offsetX + frameWidth - borderRadius},${offsetY + frameHeight} Q ${offsetX + frameWidth},${offsetY + frameHeight} ${offsetX + frameWidth},${offsetY + frameHeight - borderRadius} L ${offsetX + frameWidth},${offsetY + frameHeight - cornerLength}`;
  const scanLineY = offsetY + (scanProgress / 100) * frameHeight;

  return (
    <Canvas
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Path
        path={topLeftPath}
        color={color}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
      >
        {isScanning && <Shadow dx={0} dy={0} blur={10} color={PURPLE} />}
      </Path>
      <Path
        path={topRightPath}
        color={color}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
      >
        {isScanning && <Shadow dx={0} dy={0} blur={10} color={PURPLE} />}
      </Path>
      <Path
        path={bottomLeftPath}
        color={color}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
      >
        {isScanning && <Shadow dx={0} dy={0} blur={10} color={PURPLE} />}
      </Path>
      <Path
        path={bottomRightPath}
        color={color}
        style="stroke"
        strokeWidth={strokeWidth}
        strokeCap="round"
        strokeJoin="round"
      >
        {isScanning && <Shadow dx={0} dy={0} blur={10} color={PURPLE} />}
      </Path>

      {!isScanning && (
        <>
          <Line
            p1={{ x: offsetX + 28, y: eyeLineY }}
            p2={{ x: offsetX + frameWidth - 28, y: eyeLineY }}
            color="rgba(255,255,255,0.28)"
            strokeWidth={1.5}
          />
          <Line
            p1={{ x: offsetX + 48, y: chinGuideY }}
            p2={{ x: offsetX + frameWidth - 48, y: chinGuideY }}
            color="rgba(255,255,255,0.16)"
            strokeWidth={1}
          />
        </>
      )}

      {isScanning && (
        <Line
          p1={{ x: offsetX + 8, y: scanLineY }}
          p2={{ x: offsetX + frameWidth - 8, y: scanLineY }}
          color={PURPLE}
          strokeWidth={2}
        >
          <Shadow dx={0} dy={0} blur={10} color={PURPLE} />
        </Line>
      )}
    </Canvas>
  );
}

export default function FaceScanTab() {
  const device = useCameraDevice("front");
  const photoOutput = usePhotoOutput();
  const camRef = useRef<CameraRef>(null);
  const { hasPermission, requestPermission } = useCameraPermission();

  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [cameraLayout, setCameraLayout] = useState({ width: 0, height: 0 });

  const faceComplete = useVerificationStore((s) => s.faceComplete);
  const storedFaceUri = useVerificationStore((s) => s.faceImageUri);
  const setFaceImageUri = useVerificationStore((s) => s.setFaceImageUri);
  const setFaceComplete = useVerificationStore((s) => s.setFaceComplete);
  const showToast = useUIStore((s) => s.showToast);

  const frameMetrics = getFaceFrameMetrics(
    cameraLayout.width,
    cameraLayout.height,
  );

  useEffect(() => {
    if (!hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);

  if (faceComplete && storedFaceUri) {
    return (
      <View
        className="flex-1 bg-background rounded-2xl overflow-hidden"
        style={{ minHeight: 320 }}
      >
        <Image
          source={{ uri: storedFaceUri }}
          className="flex-1"
          resizeMode="cover"
        />
        <View className="absolute top-3 right-3">
          <TouchableOpacity
            onPress={() => {
              setFaceComplete(false);
              setFaceImageUri("");
              setCapturedUri(null);
            }}
            className="bg-black/55 rounded-2xl p-2.5"
          >
            <X size={20} color="white" />
          </TouchableOpacity>
        </View>
        <View className="absolute bottom-4 left-0 right-0 items-center">
          <View className="bg-primary/90 px-4 py-2 rounded-2xl">
            <Text className="text-primary-foreground font-medium">
              Selfie Captured
            </Text>
          </View>
        </View>
      </View>
    );
  }

  if (!device) {
    return (
      <View
        className="flex-1 bg-card rounded-2xl items-center justify-center"
        style={{ minHeight: 320 }}
      >
        <Text className="text-muted">Camera not available</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View
        className="flex-1 bg-card rounded-2xl items-center justify-center px-6"
        style={{ minHeight: 320 }}
      >
        <Text className="text-foreground text-center font-semibold">
          Camera permission required
        </Text>
        <Text className="text-muted text-center mt-2">
          We need camera access to capture your verification selfie.
        </Text>
        <Button onPress={() => void requestPermission()} className="mt-4">
          <Text className="text-primary-foreground">Grant Access</Text>
        </Button>
      </View>
    );
  }

  async function capture() {
    try {
      setBusy(true);
      setIsScanning(true);
      setScanProgress(0);

      const duration = 1200;
      const startTime = Date.now();

      await new Promise<void>((resolve) => {
        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min((elapsed / duration) * 100, 100);
          setScanProgress(progress);

          if (progress < 100) {
            requestAnimationFrame(animate);
          } else {
            resolve();
          }
        };
        requestAnimationFrame(animate);
      });

      const photo = await photoOutput.capturePhoto({ flashMode: "off" }, {});
      const filePath = await photo.saveToTemporaryFileAsync();
      const uri = filePath.startsWith("file://")
        ? filePath
        : `file://${filePath}`;
      setCapturedUri(uri);
    } catch (e: any) {
      showToast("error", "Capture failed", e?.message);
    } finally {
      setBusy(false);
      setIsScanning(false);
      setScanProgress(0);
    }
  }

  async function confirm() {
    if (!capturedUri) return;
    try {
      setBusy(true);
      const saved = await persistVerificationPhoto(capturedUri, "selfie");
      setFaceImageUri(saved);
      setFaceComplete(true);
      showToast("success", "Face scan complete");
    } catch (e: any) {
      showToast("error", "Face verification failed", e?.message);
    } finally {
      setBusy(false);
    }
  }

  if (capturedUri) {
    return (
      <View
        className="flex-1 bg-background rounded-2xl overflow-hidden"
        style={{ minHeight: 320 }}
      >
        <Image
          source={{ uri: capturedUri }}
          className="flex-1"
          resizeMode="cover"
        />

        <View className="absolute bottom-6 left-0 right-0 px-6 gap-3">
          <Text className="text-center text-white text-sm">
            Make sure your face is centered, clear, and well lit.
          </Text>
          <Text className="text-center text-white/70 text-xs">
            This selfie is used only to confirm the ID belongs to you.
          </Text>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              onPress={() => setCapturedUri(null)}
              className="flex-1 bg-black/30"
            >
              <Text className="text-white">Retake</Text>
            </Button>
            <Button onPress={confirm} disabled={busy} className="flex-1">
              <Text className="text-primary-foreground">
                {busy ? "Saving..." : "Use This Selfie"}
              </Text>
            </Button>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      className="flex-1 rounded-2xl overflow-hidden"
      style={{ minHeight: 420 }}
    >
      <View className="justify-center flex-row items-center px-4 py-3 bg-card">
        <Text className="text-foreground text-center font-semibold">
          Face Verification
        </Text>
      </View>

      <View
        className="flex-1 bg-background"
        onLayout={(e) =>
          setCameraLayout({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
      >
        <Camera
          ref={camRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          outputs={[photoOutput]}
        />

        <View className="absolute top-4 left-4 right-4 flex-row justify-between items-start">
          <View className="bg-black/60 px-3 py-2 rounded-2xl">
            <Text className="text-white text-xs font-medium">
              {isScanning ? `Scanning ${Math.round(scanProgress)}%` : "Ready"}
            </Text>
          </View>
          <View className="bg-black/45 px-3 py-2 rounded-2xl">
            <Text className="text-white/85 text-xs font-medium">
              Good light
            </Text>
          </View>
        </View>

        <FaceFrameOverlay
          isScanning={isScanning}
          scanProgress={scanProgress}
          containerWidth={cameraLayout.width}
          containerHeight={cameraLayout.height}
        />

        {!isScanning && frameMetrics && (
          <View
            pointerEvents="none"
            style={[
              styles.eyeGuide,
              {
                top: Math.max(frameMetrics.offsetY - 18, 16),
                left: frameMetrics.offsetX + 28,
              },
            ]}
          >
            <Text style={styles.eyeGuideText}>Eyes on the line</Text>
          </View>
        )}

        {!isScanning && (
          <View className="absolute left-0 right-0 bottom-20 px-6 items-center">
            <View className="rounded-2xl px-4 py-3 bg-black/42 border border-white/10 max-w-[320px]">
              <Text className="text-white text-base text-center font-semibold">
                Center your face inside the frame.
              </Text>
              <Text className="text-white/72 text-sm text-center mt-1">
                Keep your eyes on the line. Remove hats if possible, hold still,
                and use the same face you want matched to your ID.
              </Text>
            </View>
          </View>
        )}

        <View className="absolute bottom-4 left-0 right-0 px-6">
          <Text className="text-center text-white/72 text-sm font-medium">
            {isScanning
              ? "Hold still while we capture your selfie."
              : "Use the front camera with your full face inside the frame. This is not shown on your public profile."}
          </Text>
        </View>
      </View>

      <View className="p-3 bg-card">
        <Button
          onPress={capture}
          disabled={busy || isScanning}
          className="flex-row items-center justify-center"
        >
          <View className="flex-row mr-3 items-center">
            <CameraIcon size={20} color="white" style={{ marginRight: 2 }} />
          </View>
          <Text className="text-primary-foreground text-center tracking-wider font-extrabold">
            {isScanning ? "Scanning..." : busy ? "Capturing..." : "Take Selfie"}
          </Text>
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  eyeGuide: {
    position: "absolute",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  eyeGuideText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
});
