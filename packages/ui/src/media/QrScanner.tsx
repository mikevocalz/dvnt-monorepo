import { useRef } from "react";
import { View, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Text } from "react-native";

export interface QrScannerProps {
  onScan: (text: string) => void;
  onError?: (message: string) => void;
  oneShot?: boolean;
}

/** Native QR/barcode scanner via expo-camera. Mirror of `QrScanner.web.tsx`. */
export function QrScanner({ onScan, oneShot = true }: QrScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const doneRef = useRef(false);

  if (!permission?.granted) {
    return (
      <View style={{ alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "#000", borderRadius: 16 }}>
        <Text style={{ color: "#fff", textAlign: "center" }}>Camera access is needed to scan.</Text>
        <Pressable onPress={requestPermission} style={{ paddingHorizontal: 20, height: 44, borderRadius: 14, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Grant access</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ aspectRatio: 1, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (oneShot && doneRef.current) return;
          doneRef.current = true;
          onScan(data);
        }}
      />
    </View>
  );
}
