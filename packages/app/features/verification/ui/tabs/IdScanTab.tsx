import { View, Text, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import { useRef, useState, useEffect } from "react";
import {
  Camera,
  type CameraRef,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from "react-native-vision-camera";
// TextRecognition removed due to GoogleMLKit version conflict - see CLAUDE.md
// TODO: Re-add OCR when compatible version is available
import * as ImagePicker from "expo-image-picker";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import {
  CreditCard,
  Camera as CameraIcon,
  ImageIcon,
  X,
  ScanLine,
} from "lucide-react-native";
import { persistVerificationPhoto } from "@dvnt/app/lib/media";
import { useVerificationStore } from "@dvnt/app/lib/stores/useVerificationStore";
import { Button, Progress } from "@dvnt/app/components/ui";
import { extractDOBFromText } from "@dvnt/app/lib/dob-extractor";

type Mode = "select" | "camera" | "preview" | "scanning";

export default function IdScanTab() {
  const [mode, setMode] = useState<Mode>("select");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [ocrText, setOcrText] = useState<string>("");
  const [extractedDob, setExtractedDob] = useState<string | null>(null);

  const photoOutput = usePhotoOutput();
  const camRef = useRef<CameraRef>(null);
  const device = useCameraDevice("back");
  const { hasPermission, requestPermission } = useCameraPermission();
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    if (mode === "camera" && !hasPermission) {
      void requestPermission();
    }
  }, [hasPermission, mode, requestPermission]);

  // Simulate scanning progress
  useEffect(() => {
    if (mode !== "scanning") return;

    setScanProgress(0);
    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }
        return prev + Math.random() * 15;
      });
    }, 300);

    return () => clearInterval(interval);
  }, [mode]);

  const idComplete = useVerificationStore((s) => s.idComplete);
  const storedImageUri = useVerificationStore((s) => s.idImageUri);
  const setIdComplete = useVerificationStore((s) => s.setIdComplete);
  const setIdImageUri = useVerificationStore((s) => s.setIdImageUri);
  const setParsedId = useVerificationStore((s) => s.setParsedId);

  const handleChooseFromLibrary = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== "granted") {
        showToast(
          "error",
          "Permission Required",
          "Please allow photo library access to upload your ID.",
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 0.8,
        selectionLimit: 1,
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        showToast(
          "error",
          "Upload Failed",
          "We couldn't load that image. Please try another one.",
        );
        return;
      }

      setOcrText("");
      setExtractedDob(null);
      setImageUri(asset.uri);
      setMode("preview");
    } catch (error: any) {
      console.error("[IdScanTab] Library pick error:", error);
      showToast(
        "error",
        "Upload Failed",
        error?.message || "Failed to add image. Please try again.",
      );
    }
  };

  // Handle scan completion in useEffect to avoid setState during render
  useEffect(() => {
    if (mode !== "scanning" || !imageUri || scanProgress < 100 || busy) return;

    setBusy(true);

    // Extract DOB from accumulated OCR text
    const dobResult = extractDOBFromText(ocrText);
    console.log("[IdScanTab] DOB extraction result:", dobResult);

    if (dobResult.dateOfBirth) {
      setParsedId({ dob: dobResult.dateOfBirth });
      setExtractedDob(dobResult.dateOfBirth);
      console.log("[IdScanTab] Extracted DOB:", dobResult.formattedDate);
    }

    persistVerificationPhoto(imageUri, "id")
      .then((saved) => {
        setIdImageUri(saved);
        setIdComplete(true);
        if (dobResult.dateOfBirth) {
          showToast("success", "ID Scanned", `DOB: ${dobResult.formattedDate}`);
        } else {
          showToast("success", "ID scanned successfully");
        }
      })
      .catch((e: any) => {
        showToast("error", "Error", e?.message ?? "Failed to save ID");
        setMode("preview");
      })
      .finally(() => setBusy(false));
  }, [
    mode,
    imageUri,
    scanProgress,
    busy,
    ocrText,
    setParsedId,
    setIdImageUri,
    setIdComplete,
  ]);

  // If already completed, show the stored image
  if (idComplete && storedImageUri) {
    return (
      <View
        className="flex-1 bg-background rounded-2xl overflow-hidden"
        style={{ minHeight: 300 }}
      >
        <Image
          source={{ uri: storedImageUri }}
          style={{ flex: 1 }}
          contentFit="contain"
        />
        <View className="absolute top-3 right-3">
          <TouchableOpacity
            onPress={() => {
              setIdComplete(false);
              setIdImageUri("");
              setParsedId({});
              setImageUri(null);
              setMode("select");
            }}
            className="bg-black/50 rounded-full p-2"
          >
            <X size={20} color="white" />
          </TouchableOpacity>
        </View>
        <View className="absolute bottom-4 left-0 right-0 items-center">
          <View className="bg-primary/90 px-4 py-2 rounded-full">
            <Text className="text-primary-foreground font-medium">
              ID Captured ✓
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Selection screen
  if (mode === "select") {
    return (
      <View
        className="flex-1 bg-card rounded-2xl items-center justify-center gap-6 p-6"
        style={{ minHeight: 300 }}
      >
        <View className="bg-muted/30 rounded-full p-6">
          <CreditCard size={48} className="text-muted-foreground" />
        </View>

        <View className="items-center gap-2">
          <Text className="text-lg font-semibold text-foreground">
            Scan a valid government-issued ID
          </Text>
          <Text className="text-sm text-muted text-center">
            We use your ID only to confirm you are 18+ and real. It is never
            shown on your profile.
          </Text>
        </View>

        <View className="w-full rounded-2xl border border-white/8 bg-black/20 px-4 py-3 gap-2">
          <Text className="text-sm font-semibold text-foreground">
            🔒 Your privacy is protected
          </Text>
          <Text className="text-sm leading-5 text-muted">
            Your ID is used only for instant age verification and is{" "}
            <Text className="font-semibold text-foreground">
              permanently deleted
            </Text>{" "}
            from our systems immediately after verification is complete. We do
            not store, share, or sell your ID. DVNT cannot be used to commit
            identity theft or fraud.
          </Text>
        </View>

        <View className="w-full rounded-2xl border border-white/8 bg-black/20 px-4 py-3">
          <Text className="text-sm font-semibold text-foreground">
            Before you capture
          </Text>
          <Text className="mt-1 text-sm leading-5 text-muted">
            Use the front of your ID, keep all edges visible, and avoid glare or
            blur.
          </Text>
        </View>

        <View className="w-full gap-3">
          <Button
            onPress={() => {
              setOcrText("");
              setMode("camera");
            }}
            className="flex-row items-center justify-center gap-2"
          >
            <CameraIcon size={18} color="white" />
            <Text className="text-primary-foreground font-medium">
              Take Photo
            </Text>
          </Button>

          <Button
            variant="outline"
            onPress={() => {
              void handleChooseFromLibrary();
            }}
            className="flex-row items-center justify-center gap-2"
          >
            <ImageIcon size={18} className="text-foreground" />
            <Text className="text-foreground font-medium">
              Choose from Library
            </Text>
          </Button>
        </View>
      </View>
    );
  }

  // Camera mode
  if (mode === "camera") {
    if (!hasPermission) {
      return (
        <View
          className="flex-1 bg-card rounded-2xl items-center justify-center px-6"
          style={{ minHeight: 300 }}
        >
          <Text className="text-foreground text-center font-semibold">
            Camera permission required
          </Text>
          <Text className="text-muted text-center mt-2">
            Allow camera access to capture your ID.
          </Text>
          <Button onPress={() => void requestPermission()} className="mt-4">
            <Text className="text-primary-foreground">Grant Access</Text>
          </Button>
          <Button
            variant="outline"
            onPress={() => setMode("select")}
            className="mt-3"
          >
            Go Back
          </Button>
        </View>
      );
    }

    if (!device) {
      return (
        <View
          className="flex-1 bg-card rounded-2xl items-center justify-center"
          style={{ minHeight: 300 }}
        >
          <Text className="text-muted">Camera not available</Text>
          <Button
            variant="outline"
            onPress={() => setMode("select")}
            className="mt-4"
          >
            Go Back
          </Button>
        </View>
      );
    }

    return (
      <View
        className="flex-1 bg-background rounded-2xl overflow-hidden"
        style={{ minHeight: 300 }}
      >
        <Camera
          ref={camRef}
          style={{ flex: 1 }}
          device={device}
          isActive
          outputs={[photoOutput]}
        />

        {/* ID frame overlay */}
        <View
          className="absolute inset-0 items-center justify-center"
          pointerEvents="none"
        >
          <View
            className="border-2 border-white/70 rounded-xl"
            style={{ width: "85%", aspectRatio: 1.6 }}
          />
        </View>

        <View className="absolute bottom-6 left-0 right-0 px-6 gap-3">
          <Text className="text-center text-white text-sm mb-2">
            Position your ID inside the frame with all corners visible.
          </Text>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              onPress={() => setMode("select")}
              className="flex-1 bg-black/30"
            >
              <Text className="text-white">Cancel</Text>
            </Button>
            <Button
              onPress={async () => {
                try {
                  setBusy(true);
                  const photo = await photoOutput.capturePhoto({}, {});
                  const filePath = await photo.saveToTemporaryFileAsync();
                  const uri = filePath.startsWith("file://")
                    ? filePath
                    : `file://${filePath}`;
                  setImageUri(uri);
                  setMode("preview");
                } catch (e: any) {
                  showToast("error", "Capture failed", e?.message);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              className="flex-1"
            >
              <Text className="text-primary-foreground">
                {busy ? "Capturing..." : "Capture"}
              </Text>
            </Button>
          </View>
        </View>
      </View>
    );
  }

  // Preview mode
  if (mode === "preview" && imageUri) {
    return (
      <View
        className="flex-1 bg-background rounded-2xl overflow-hidden"
        style={{ minHeight: 300 }}
      >
        <Image
          source={{ uri: imageUri }}
          style={{ flex: 1 }}
          contentFit="contain"
        />

        <View className="absolute bottom-6 left-0 right-0 px-6 gap-3">
          <Text className="text-center text-muted text-sm mb-2">
            Make sure the photo is clear, readable, and free of glare.
          </Text>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              onPress={() => {
                setImageUri(null);
                setMode("select");
              }}
              className="flex-1"
            >
              <Text className="text-foreground">Retake</Text>
            </Button>
            <Button
              onPress={() => setMode("scanning")}
              disabled={busy}
              className="flex-1"
            >
              <Text className="text-primary-foreground">Use This Photo</Text>
            </Button>
          </View>
        </View>
      </View>
    );
  }

  // Scanning mode with progress bar
  if (mode === "scanning" && imageUri) {
    const progressValue = Math.min(Math.round(scanProgress), 100);

    return (
      <View
        className="flex-1 bg-card rounded-2xl items-center justify-center gap-6 p-6"
        style={{ minHeight: 300 }}
      >
        {/* Scan icon */}
        <View className="bg-primary/20 rounded-full p-6">
          <ScanLine size={48} className="text-primary" />
        </View>

        <Text className="text-lg font-semibold text-foreground">
          Scanning ID Document...
        </Text>

        {/* Progress bar */}
        <View className="w-full gap-2">
          <Progress value={progressValue} className="h-2" />
          <Text className="text-center text-muted text-sm">
            {progressValue}% complete
          </Text>
        </View>

        {/* Show extracted info */}
        {ocrText.length > 50 && (
          <View className="bg-muted/20 rounded-lg p-3 w-full">
            <Text className="text-xs text-muted text-center">
              Text detected: {ocrText.length} characters
            </Text>
          </View>
        )}
      </View>
    );
  }

  return null;
}
