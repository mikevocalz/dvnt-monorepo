import { normalizeLynkRoomId } from "../../features/sneaky-lynk/room-links.ts";

/** Navigation only. A room link never grants membership or skips pre-join. */
export function roomReturnPath(raw: string): string | null {
  if (!raw || /[\\\u0000-\u0020\u007f]/.test(raw)) return null;
  const pathname = raw.split(/[?#]/, 1)[0];
  const match = /^\/(?:(?:feed\/)?sneaky-lynk\/room|sl|sneaky|(?:feed\/)?sneaky-lynk)\/([^/]+)\/?$/.exec(pathname);
  if (!match || match[0] !== pathname) return null;
  let id: string;
  try { id = decodeURIComponent(match[1]); } catch { return null; }
  // Encoded separators, nested escapes and dot segments are invalid.
  if (!normalizeLynkRoomId(id)) return null;
  if (/^\/sneaky\//.test(pathname) && ["success", "cancel"].includes(id)) return null;
  if (/^\/(?:feed\/)?sneaky-lynk\/[^/]+\/?$/.test(pathname) && ["create", "billing", "room"].includes(id)) return null;
  // Room identity is in the path, never query-provided id/returnTo/next/title.
  return `/feed/sneaky-lynk/room/${id}`;
}
