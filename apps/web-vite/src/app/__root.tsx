import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'

import { getInitialHtmlAttrsFn } from '../functions/theme.functions'

export const Route = createRootRoute({
  // Resolve admin theme / language / text-direction server-side so `<html>`
  // gets the right `data-theme`/`lang`/`dir` on first paint (mirrors Next).
  loader: () => getInitialHtmlAttrsFn(),
  component: RootComponent,
  head: () => ({
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
})

function RootComponent() {
  const { dir, languageCode, theme } = Route.useLoaderData()

  return (
    <html data-theme={theme} dir={dir} lang={languageCode} suppressHydrationWarning>
      <head>
        {/* The cascade-layer order + base typography live in `base-layers.css`
         * (imported in _payload.tsx). Keep <head> free of inline <style>/<script>
         * JSX so SSR and client markup match — see base-layers.css for why. */}
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
