import { View } from "react-native";
import { Text } from "react-native";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapPickerProps {
  apiKey?: string;
  value?: LatLng | null;
  defaultCenter?: LatLng;
  onChange?: (point: LatLng) => void;
  readOnly?: boolean;
  zoom?: number;
  height?: number;
}

/**
 * Native map picker shell — native screens use react-native-maps directly. This
 * keeps the universal kit import resolvable. Mirror of `MapPicker.web.tsx`.
 */
export function MapPicker({ height = 280 }: MapPickerProps) {
  return (
    <View style={{ height, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" }}>
      <Text style={{ color: "rgba(255,255,255,0.4)" }}>Map</Text>
    </View>
  );
}
