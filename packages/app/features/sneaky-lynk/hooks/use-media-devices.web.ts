/** Browser device inventory only. Never requests capture or stores device IDs
 * outside this room's in-memory UI lifetime. Missing devices stay explicit;
 * never silently substitute a different camera for a person's reviewed choice. */
import { useCallback, useEffect, useState } from "react";

export function useMediaDevices(refreshKey?: unknown) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let current = true;
    let request = 0;
    const media = navigator.mediaDevices;
    const update = async () => {
      const id = ++request;
      try {
        if (!media?.enumerateDevices) throw new Error("unavailable");
        const list = await media.enumerateDevices();
        if (current && id === request) { setDevices(list); setError(null); }
      } catch {
        if (current && id === request) setError("Device names aren't available. Check browser permissions, then refresh.");
      }
    };
    void update();
    media?.addEventListener?.("devicechange", update);
    return () => { current = false; media?.removeEventListener?.("devicechange", update); };
  }, [refreshKey, revision]);
  return { devices, error, refresh };
}
