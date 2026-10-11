/** Embed-only configuration. Never changes the existing site's Stripe environment.
 * Syntax/mode checks are not credential authentication or a sandbox acceptance test.
 */
export function resolveTicketEmbedRuntime(env: (name: string) => string | undefined) {
  const secretKey = env('STRIPE_SECRET_KEY') || '';
  const publishableKey = env('STRIPE_PUBLISHABLE_KEY') || '';
  const secretMode = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(secretKey)?.[1];
  const publicMode = /^pk_(test|live)_[A-Za-z0-9]+$/.exec(publishableKey)?.[1];
  const problems: string[] = [];
  if (!secretMode) problems.push('STRIPE_SECRET_KEY must be a configured secret or restricted key, not a placeholder.');
  if (!publicMode) problems.push('STRIPE_PUBLISHABLE_KEY must be a configured publishable key, not a placeholder.');
  if (secretMode && publicMode && secretMode !== publicMode) problems.push('Stripe key modes do not match.');

  let siteOrigin = '';
  const rawSite = env('PUBLIC_SITE_URL') || '';
  try {
    if (!rawSite || /[\s\\]/.test(rawSite)) throw new Error();
    const site = new URL(rawSite);
    if (site.protocol !== 'https:' || site.username || site.password || site.port ||
        (rawSite !== site.origin && rawSite !== `${site.origin}/`)) throw new Error();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(site.hostname) ||
        /\.(?:localhost|local|internal|test)$/i.test(site.hostname)) throw new Error();
    siteOrigin = site.origin;
  } catch {
    problems.push('PUBLIC_SITE_URL must explicitly name this deployment as a public HTTPS origin.');
  }
  // A known production host is never an acceptable sandbox origin. An arbitrary
  // other host is not proof of isolation: the release test still verifies staging.
  const productionHosts = new Set(['dvntapp.live', 'www.dvntapp.live', 'dvnt.live', 'www.dvnt.live', 'dvntlive.app', 'www.dvntlive.app', 'dvnt-blog.vercel.app']);
  if (secretMode === 'test' && siteOrigin && productionHosts.has(new URL(siteOrigin).hostname)) {
    problems.push('Stripe test keys require an isolated staging PUBLIC_SITE_URL, not a DVNT production host.');
  }
  return {
    secretKey, publishableKey, siteOrigin,
    livemode: secretMode === 'live',
    paymentsEnabled: env('TICKET_EMBED_PAYMENTS_ENABLED') === 'true' && problems.length === 0,
    // These fixed messages contain no key values and may be logged server-side.
    problems,
  };
}
