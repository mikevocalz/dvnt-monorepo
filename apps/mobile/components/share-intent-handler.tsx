import { useEffect } from "react";
import { useShareIntentSafe } from "@/lib/safe-native-modules";
import { useSpotifyShareStore } from "@/lib/spotify/spotify-share-store";
import {
  extractSpotifyUrl,
  fetchSpotifyOEmbed,
} from "@/lib/spotify/parse-spotify-link";
import { useDeepLinkStore } from "@/lib/stores/deep-link-store";
import { useAppStore } from "@/lib/stores/app-store";

type ShareFile = { path: string; mimeType?: string };

function getShareMetaImage(
  meta: Record<string, unknown> | undefined,
): string | null {
  if (!meta) return null;

  const candidates = [
    meta["og:image"],
    meta["twitter:image"],
    meta.image,
    meta.imageUrl,
    meta.thumbnail_url,
    meta.thumbnailUrl,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

export function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentSafe();
  const processSharedText = useSpotifyShareStore((s) => s.processSharedText);
  const setOpenedFromShareIntent = useDeepLinkStore((s) => s.setOpenedFromShareIntent);
  const setPendingShareIntentRoute = useAppStore(
    (s) => s.setPendingShareIntentRoute,
  );

  useEffect(() => {
    if (!hasShareIntent || !shareIntent || typeof shareIntent !== "object")
      return;

    void (async () => {
      try {
        const s = shareIntent as {
          text?: string;
          webUrl?: string;
          files?: ShareFile[];
          meta?: Record<string, unknown>;
        };
        const text = s.text ?? s.webUrl ?? "";
        const spotifyUrl =
          typeof text === "string" ? extractSpotifyUrl(text) : null;
        const isSpotifyShare = Boolean(spotifyUrl);

        const files = s.files as ShareFile[] | undefined;
        if (files && files.length > 0) {
          const first = files[0];
          if (first?.path) {
            const isVideo =
              first.mimeType?.startsWith("video/") ||
              !!first.path.match(/\.(mp4|mov|webm)$/i);
            setPendingShareIntentRoute({
              pathname: "/(protected)/story/create",
              params: {
                sharedUri: encodeURIComponent(first.path),
                sharedType: isVideo ? "video" : "image",
                openEditor: isSpotifyShare ? "0" : "1",
                sharedAt: String(Date.now()),
              },
            });
            setOpenedFromShareIntent(false);
            resetShareIntent();
            return;
          }
        }

        const metaImage = getShareMetaImage(s.meta);

        if (metaImage && isSpotifyShare) {
          setPendingShareIntentRoute({
            pathname: "/(protected)/story/create",
            params: {
              sharedUri: encodeURIComponent(metaImage),
              sharedType: "image",
              openEditor: "0",
              sharedAt: String(Date.now()),
            },
          });
          setOpenedFromShareIntent(false);
          resetShareIntent();
          return;
        }

        if (spotifyUrl) {
          const oEmbed = await fetchSpotifyOEmbed(spotifyUrl);
          const thumbnailUrl = oEmbed?.thumbnail_url;

          if (thumbnailUrl) {
            setPendingShareIntentRoute({
              pathname: "/(protected)/story/create",
              params: {
                sharedUri: encodeURIComponent(thumbnailUrl),
                sharedType: "image",
                openEditor: "0",
                sharedAt: String(Date.now()),
              },
            });
            setOpenedFromShareIntent(false);
            resetShareIntent();
            return;
          }
        }

        if (typeof text === "string" && text.trim()) {
          processSharedText(text);
        }
      } catch (e) {
        console.warn("[ShareIntentHandler] Error processing share:", e);
      }
      try {
        setOpenedFromShareIntent(false);
        resetShareIntent();
      } catch {
        // noop
      }
    })();
  }, [
    hasShareIntent,
    processSharedText,
    resetShareIntent,
    setOpenedFromShareIntent,
    setPendingShareIntentRoute,
    shareIntent,
  ]);

  return null;
}
