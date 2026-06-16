import { Stack, useRouter } from "expo-router";
import { FishjamProvider } from "@fishjam-cloud/react-native-client";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useVideoRoomStore } from "@dvnt/app/src/video/stores/video-room-store";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";

const FISHJAM_APP_ID = resolveFishjamAppId();

if (__DEV__) {
  console.log("[CallLayout] FISHJAM_APP_ID:", FISHJAM_APP_ID);
}

export default function CallLayout() {
  const router = useRouter();

  return (
    <ErrorBoundary
      screenName="Call"
      onGoBack={() => {
        // Reset call state on error dismiss so next call starts clean
        useVideoRoomStore.getState().reset();
        router.back();
      }}
      onGoHome={() => {
        useVideoRoomStore.getState().reset();
        router.replace("/(protected)/(tabs)");
      }}
    >
      <FishjamProvider fishjamId={FISHJAM_APP_ID} debug={__DEV__}>
        <Stack screenOptions={{ headerShown: false }} />
      </FishjamProvider>
    </ErrorBoundary>
  );
}
