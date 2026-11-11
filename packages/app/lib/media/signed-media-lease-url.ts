/** Validate a server-issued exact-object capability, not its secret signature.
 * Only the CDN can verify the HMAC. Client validation forbids raw/redirect/transform fallbacks. */
export function isSignedMediaLeaseUrl(value: unknown, expiresAt: number): value is string {
  if(typeof value !== 'string' || !Number.isSafeInteger(expiresAt))return false;
  try {
    const url=new URL(value),keys=[...url.searchParams.keys()];
    return url.href===value && url.protocol==='https:' && !url.username && !url.password && !url.hash &&
      /^\/(post-image|post-video|posts)\/[A-Za-z0-9_./-]+$/.test(url.pathname) &&
      keys.length===2 && url.searchParams.getAll('token').length===1 && url.searchParams.getAll('expires').length===1 &&
      /^HS256-[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('token') || '') &&
      url.searchParams.get('expires')===String(expiresAt);
  } catch { return false; }
}
