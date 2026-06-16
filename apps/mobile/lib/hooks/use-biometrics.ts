/**
 * Biometric Authentication Hook
 * Face ID / Touch ID for app security
 */

import { useState, useEffect, useCallback } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const BIOMETRIC_ENABLED_KEY = "biometric_auth_enabled";

export type BiometricType = "fingerprint" | "facial" | "iris" | "none";

interface BiometricState {
  isAvailable: boolean;
  biometricType: BiometricType;
  isEnabled: boolean;
  isAuthenticating: boolean;
}

export function useBiometrics() {
  const [state, setState] = useState<BiometricState>({
    isAvailable: false,
    biometricType: "none",
    isEnabled: false,
    isAuthenticating: false,
  });

  // Check if biometrics are available on this device
  const checkAvailability = useCallback(async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      const types =
        await LocalAuthentication.supportedAuthenticationTypesAsync();

      let biometricType: BiometricType = "none";
      if (
        types.includes(
          LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
        )
      ) {
        biometricType = "facial";
      } else if (
        types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
      ) {
        biometricType = "fingerprint";
      } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
        biometricType = "iris";
      }

      const isAvailable = compatible && enrolled;

      // Check if user has enabled biometrics
      const enabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      const isEnabled = enabled === "true";

      setState((prev) => ({
        ...prev,
        isAvailable,
        biometricType,
        isEnabled: isAvailable && isEnabled,
      }));

      return { isAvailable, biometricType };
    } catch (error) {
      console.error("[Biometrics] Check availability failed:", error);
      return { isAvailable: false, biometricType: "none" as BiometricType };
    }
  }, []);

  // Authenticate with biometrics
  const authenticate = useCallback(
    async (
      promptMessage: string = "Authenticate to continue",
    ): Promise<{ success: boolean; error?: string }> => {
      setState((prev) => ({ ...prev, isAuthenticating: true }));

      try {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage,
          cancelLabel: "Cancel",
          disableDeviceFallback: false, // Allow PIN/password fallback
          fallbackLabel: "Use Password",
        });

        setState((prev) => ({ ...prev, isAuthenticating: false }));

        if (result.success) {
          return { success: true };
        } else {
          return {
            success: false,
            error: result.error || "Authentication failed",
          };
        }
      } catch (error: any) {
        setState((prev) => ({ ...prev, isAuthenticating: false }));
        return {
          success: false,
          error: error?.message || "Authentication error",
        };
      }
    },
    [],
  );

  // Enable biometric authentication
  const enable = useCallback(async (): Promise<boolean> => {
    try {
      // First check availability before prompting
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!compatible || !enrolled) {
        console.error(
          "[Biometrics] Enable failed: not available or not enrolled",
        );
        return false;
      }

      // First verify biometrics work
      const result = await authenticate("Enable biometric authentication");
      if (result.success) {
        await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY, "true");
        setState((prev) => ({ ...prev, isEnabled: true }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("[Biometrics] Enable failed:", error);
      return false;
    }
  }, [authenticate]);

  // Disable biometric authentication
  const disable = useCallback(async (): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
      setState((prev) => ({ ...prev, isEnabled: false }));
    } catch (error) {
      console.error("[Biometrics] Disable failed:", error);
    }
  }, []);

  // Get friendly name for biometric type
  const getBiometricName = useCallback((): string => {
    switch (state.biometricType) {
      case "facial":
        return "Face ID";
      case "fingerprint":
        return "Touch ID";
      case "iris":
        return "Iris";
      default:
        return "Biometrics";
    }
  }, [state.biometricType]);

  // Initialize on mount
  useEffect(() => {
    checkAvailability();
  }, [checkAvailability]);

  return {
    ...state,
    enable,
    disable,
    authenticate,
    checkAvailability,
    getBiometricName,
  };
}
