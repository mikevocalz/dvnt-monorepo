/**
 * One native livestream viewer tile — calls `useLivestreamViewer()` for a single
 * publisher's WHEP stream and renders it through the shared `<VideoTile>`
 * (`RTCView`). The Lynk native screen mounts one of these per active publisher
 * (host + cohost + speakers). Must run under `<FishjamProvider>`.
 */

import { useEffect } from "react";
import { useLivestreamViewer } from "@fishjam-cloud/react-native-client";
import { VideoTile } from "@dvnt/ui";

export function LivestreamTile({
  token,
  label,
  muted,
}: {
  token: string;
  label?: string;
  muted?: boolean;
}) {
  const { stream, connect, disconnect } = useLivestreamViewer();

  useEffect(() => {
    void connect({ token });
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <VideoTile
      // RN MediaStream is structurally distinct from the DOM lib type.
      stream={(stream ?? undefined) as unknown as MediaStream}
      label={label}
      muted={muted}
      className="flex-1"
    />
  );
}
