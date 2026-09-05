import { View } from "react-native";
import { Main } from "@dvnt/app/components/ui/html";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { PublicBrowseBanner } from "@dvnt/app/components/access/PublicBrowseBanner";
import { Feed } from "@dvnt/app/components/feed/feed";
import { usePublicGateStore } from "@dvnt/app/lib/stores/public-gate-store";
import { ScreenShell } from "@dvnt/app/components/layout/screen-shell";

export default function PublicHomeScreen() {
  const openGate = usePublicGateStore((s) => s.openGate);

  return (
    <ScreenShell>
      <Main className="flex-1">
        <ErrorBoundary screenName="PublicFeed">
          <Feed
            guestMode
            onGuestGate={openGate}
            headerContent={<PublicBrowseBanner variant="feed" />}
          />
        </ErrorBoundary>
      </Main>
    </ScreenShell>
  );
}
