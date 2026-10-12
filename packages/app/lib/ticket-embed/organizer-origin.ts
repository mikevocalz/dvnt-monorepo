/** Browser-side guidance only. The edge function remains the authority for origin validation. */
export function prepareOrganizerOrigin(value: string): {origin: string | null; error: string | null} {
  const raw = value.trim();
  if (!raw) return {origin: null, error: 'Enter the website where you will display the ticket widget.'};

  // Organizers commonly paste a bare domain from their browser's address bar.
  // Only a bare, syntactically valid hostname can receive the HTTPS prefix.
  const bareHost = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i;
  const candidate = bareHost.test(raw) ? `https://${raw}` : raw;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.pathname !== '/' || url.search || url.hash ||
        !bareHost.test(url.hostname) || /\.(?:localhost|local|internal|test)$/i.test(url.hostname) ||
        raw.length > 255 || /[\s\\]/.test(raw)) {
      throw new Error('invalid_origin');
    }
    return {origin: url.origin, error: null};
  } catch {
    return {origin: null, error: 'Use your exact HTTPS website address without a path, port, or wildcard (for example https://www.deviant.live).'};
  }
}
