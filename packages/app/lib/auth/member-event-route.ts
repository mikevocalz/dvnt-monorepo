/** Signed-in visitors use the app event detail, including old public email links.
 * The path ID is authoritative. Queries remain data, never redirect targets.
 * Guests keep the public URL; the caller must wait for auth hydration. */
export function memberEventRoute(pathname: string, search = ''): string | null {
  const match = /^\/public\/events\/([1-9]\d*)\/?$/.exec(pathname);
  if (!match || match[0] !== pathname || !Number.isSafeInteger(Number(match[1]))) return null;
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) {
    if (/^(?:returnto|next|redirect|redirect_uri|callbackurl|id|event_id|eventid)$/i.test(key)) {
      params.delete(key);
    }
  }
  const query = params.toString();
  return `/feed/events/${match[1]}${query ? `?${query}` : ''}`;
}
