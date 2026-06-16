/**
 * Custom unmatched route handler.
 * Share intents open the app with dvnt://dataUrl=dvntShareKey#text — if that
 * bypasses redirectSystemPath and lands here, redirect to home so ShareIntentHandler can process.
 */
import { useEffect } from "react";
import { Unmatched, usePathname, useRouter } from "expo-router";

const SHARE_INTENT_MARKERS = /dataUrl=|dvntShareKey/i;

export default function NotFound() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname && SHARE_INTENT_MARKERS.test(pathname)) {
      router.replace("/");
    }
  }, [pathname, router]);

  if (pathname && SHARE_INTENT_MARKERS.test(pathname)) {
    return null;
  }

  return <Unmatched />;
}
