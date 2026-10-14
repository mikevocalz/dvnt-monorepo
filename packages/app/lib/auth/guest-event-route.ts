/** Only a legacy event-detail URL has a public guest equivalent. Management,
 * wallets, checkout, and all other member routes keep their existing gate. */
export function guestEventRoute(pathname: string, search = ""): string | null {
  const match = /^\/feed\/events\/([1-9]\d*)\/?$/.exec(pathname);
  if (!match || match[0] !== pathname || !Number.isSafeInteger(Number(match[1]))) return null;

  // Keep event/ticket/promotion/payment parameters as query data, never as a
  // navigation destination. Serializing also encodes fragments and controls.
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) {
    if (/^(?:returnto|next|redirect|redirect_uri|callbackurl)$/i.test(key)) {
      params.delete(key);
    }
  }
  const query = params.toString();
  return `/public/events/${match[1]}${query ? `?${query}` : ""}`;
}
