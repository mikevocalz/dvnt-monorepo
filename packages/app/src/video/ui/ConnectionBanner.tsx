/**
 * ConnectionBanner Component
 * Shows connection status (connecting, reconnecting, poor quality, error)
 */

import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react-native";
import { c } from "./styles";
import type { ConnectionState } from "../types";

interface ConnectionBannerProps {
  connectionState: ConnectionState;
}

export function ConnectionBanner({ connectionState }: ConnectionBannerProps) {
  const { status, error } = connectionState;

  if (status === "connected") return null;

  const config = getConfig(status, error);

  return (
    <View className={`${c.connectionBanner} ${config.bgClass}`}>
      {config.showSpinner ? (
        <ActivityIndicator size="small" color={config.color} />
      ) : (
        <config.Icon size={16} color={config.color} />
      )}
      <Text style={{ color: config.color, fontSize: 13, fontWeight: "500" }}>
        {config.message}
      </Text>
    </View>
  );
}

function getConfig(status: ConnectionState["status"], error?: string) {
  switch (status) {
    case "connecting":
      return {
        Icon: Wifi,
        message: "Connecting...",
        bgClass: c.connectionConnecting,
        color: "#f59e0b",
        showSpinner: true,
      };
    case "reconnecting":
      return {
        Icon: Wifi,
        message: "Reconnecting...",
        bgClass: c.connectionReconnecting,
        color: "#f59e0b",
        showSpinner: true,
      };
    case "error":
      return {
        Icon: WifiOff,
        message: error || "Connection error",
        bgClass: c.connectionError,
        color: "#ef4444",
        showSpinner: false,
      };
    case "disconnected":
      return {
        Icon: WifiOff,
        message: "Disconnected",
        bgClass: c.connectionError,
        color: "#ef4444",
        showSpinner: false,
      };
    default:
      return {
        Icon: AlertTriangle,
        message: "Unknown status",
        bgClass: c.connectionPoor,
        color: "#f59e0b",
        showSpinner: false,
      };
  }
}

export function NetworkQualityIndicator({ quality }: { quality: "good" | "fair" | "poor" }) {
  const bars = quality === "good" ? 3 : quality === "fair" ? 2 : 1;
  const color = quality === "good" ? "#22c55e" : quality === "fair" ? "#f59e0b" : "#ef4444";

  return (
    <View className="flex-row items-end gap-0.5">
      {[1, 2, 3].map((bar) => (
        <View
          key={bar}
          style={{
            width: 3,
            height: 4 + bar * 3,
            backgroundColor: bar <= bars ? color : "rgba(255,255,255,0.2)",
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
}
