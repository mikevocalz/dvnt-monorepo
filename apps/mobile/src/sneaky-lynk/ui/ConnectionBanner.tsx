/**
 * Connection Banner Component
 * Shows connection status: Reconnecting, Poor network, Connected
 */

import { View, Text } from "react-native";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react-native";
import type { ConnectionState } from "../types";

interface ConnectionBannerProps {
  state: ConnectionState;
}

export function ConnectionBanner({ state }: ConnectionBannerProps) {
  if (state === "connected") return null;

  const config = {
    connecting: {
      bg: "bg-primary/20",
      border: "border-primary/30",
      text: "Connecting...",
      icon: <Wifi size={16} color="#FC253A" />,
      textColor: "text-primary",
    },
    reconnecting: {
      bg: "bg-yellow-500/20",
      border: "border-yellow-500/30",
      text: "Reconnecting...",
      icon: <WifiOff size={16} color="#EAB308" />,
      textColor: "text-yellow-500",
    },
    poor_network: {
      bg: "bg-orange-500/20",
      border: "border-orange-500/30",
      text: "Poor network connection",
      icon: <AlertTriangle size={16} color="#F97316" />,
      textColor: "text-orange-500",
    },
    disconnected: {
      bg: "bg-destructive/20",
      border: "border-destructive/30",
      text: "Disconnected",
      icon: <WifiOff size={16} color="#F05252" />,
      textColor: "text-destructive",
    },
  };

  const { bg, border, text, icon, textColor } = config[state];

  return (
    <View
      className={`mx-4 my-2 px-4 py-3 rounded-xl flex-row items-center gap-3 ${bg} border ${border}`}
    >
      {icon}
      <Text className={`text-sm font-medium ${textColor}`}>{text}</Text>
    </View>
  );
}
