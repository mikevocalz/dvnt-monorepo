/**
 * Real QR code wrapper around react-native-qrcode-svg, preserving the
 * original wide DVNT wordmark overlay.
 *
 * The previous fake-QR component (now removed) rendered the wordmark
 * (`./logo`, viewBox 2360×908) as a separate absolutely-positioned
 * <View> on top of the QR. That gave the wordmark its natural wide
 * aspect ratio. The QR library's built-in `logoSVG` slot forces a
 * square aspect (width = height = logoSize), so we keep the overlay
 * approach for visual parity.
 *
 * The QR itself is now a real Reed-Solomon-encoded code (the old
 * generator produced a hash-based random pattern that looked like a
 * QR but was undecodable by any reader, including our own scanner).
 * `ecl="H"` lets the QR tolerate ~30% obscuration so the wordmark
 * overlay doesn't break decoding.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import RealQRCode from "react-native-qrcode-svg";
import Logo from "./logo";

interface QRCodeProps {
  value: string;
  size?: number;
  backgroundColor?: string;
  /** Legacy prop name — maps to react-native-qrcode-svg's `color`. */
  foregroundColor?: string;
  logo?: boolean;
  logoSize?: number;
  logoBackgroundColor?: string;
}

export default function QRCode({
  value,
  size = 200,
  backgroundColor = "#FFFFFF",
  foregroundColor = "#000000",
  logo,
  logoSize = 50,
  logoBackgroundColor = "#FFFFFF",
}: QRCodeProps) {
  const logoPadding = 8;
  const overlaySize = logoSize + logoPadding * 2;
  const overlayOffset = (size - overlaySize) / 2;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <RealQRCode
        value={value || " "}
        size={size}
        color={foregroundColor}
        backgroundColor={backgroundColor}
        // High error correction lets the wordmark overlay sit on top
        // without breaking decode.
        ecl="H"
      />

      {logo ? (
        <View
          style={[
            styles.logoOverlay,
            {
              width: overlaySize,
              height: overlaySize,
              left: overlayOffset,
              top: overlayOffset,
              backgroundColor: logoBackgroundColor,
            },
          ]}
        >
          <Logo
            width={logoSize}
            height={logoSize}
            viewBox="0 0 2360 908"
            preserveAspectRatio="xMidYMid meet"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 8,
  },
  logoOverlay: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
});
