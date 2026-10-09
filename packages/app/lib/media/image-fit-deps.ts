/**
 * Platform side of fit-image-to-cap. expo-image-manipulator decodes through a
 * canvas on web (blob: in, blob: out) and natively on iOS/Android (file: in,
 * file: out), so one implementation covers both editors.
 */
import { Platform } from "react-native";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as LegacyFileSystem from "expo-file-system/legacy";
import type { FitImageDeps } from "./fit-image-to-cap";

export const imageFitDeps: FitImageDeps = {
  async byteSize(uri) {
    if (Platform.OS === "web") {
      const resp = await fetch(uri);
      if (!resp.ok) return null;
      return (await resp.blob()).size;
    }
    if (!uri.startsWith("file://")) return null;
    const info = await LegacyFileSystem.getInfoAsync(uri);
    return info.exists && typeof (info as { size?: number }).size === "number"
      ? (info as { size: number }).size
      : null;
  },
  async dimensions(uri) {
    // No actions: decode only. The re-encode it returns is discarded.
    const probe = await manipulateAsync(uri, [], { format: SaveFormat.JPEG }).catch((e: unknown) => {
      // The web build rejects with the canvas element, not an Error, when the
      // browser can't decode the file (HEIC outside Safari, for one).
      throw e instanceof Error ? e : new Error("the image format isn't supported here");
    });
    return { width: probe.width, height: probe.height };
  },
  async encode(uri, resize, quality) {
    const out = await manipulateAsync(uri, resize ? [{ resize }] : [], {
      compress: quality,
      format: SaveFormat.JPEG,
    });
    return out.uri;
  },
};
