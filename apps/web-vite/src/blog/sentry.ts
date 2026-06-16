// src/blog/sentry.ts — zero-dep Sentry bridge for the blog.
// Delegates to window.Sentry when the SDK is bootstrapped; logs safely when not.

export type BlogCtx = {
  route?: string
  slug?: string
  category?: string
  payloadCollection?: string
  editorMode?: boolean
  previewMode?: boolean
  userRole?: string
}

type Crumb =
  | 'route.entered' | 'category.selected' | 'post.opened'
  | 'post.fetch.started' | 'post.fetch.succeeded' | 'post.fetch.failed'
  | 'block.rendered' | 'newsletter.submitted' | 'share.clicked'
  | 'related.clicked' | 'preview.opened' | 'publish.attempted'

function sentry(): any | null {
  return typeof window !== 'undefined' ? (window as any).Sentry ?? null : null
}

export function capturePostError(err: unknown, ctx: BlogCtx & { operation: string }) {
  const s = sentry()
  if (s) {
    s.withScope((scope: any) => {
      scope.setTags({
        app: 'dvnt', package: 'vite-web', area: 'blog',
        route: ctx.route, slug: ctx.slug, category: ctx.category,
        payloadCollection: ctx.payloadCollection,
        editorMode: String(ctx.editorMode ?? false),
        previewMode: String(ctx.previewMode ?? false),
        ...(ctx.userRole ? { userRole: ctx.userRole } : {}),
      })
      scope.setExtra('operation', ctx.operation)
      s.captureException(err)
    })
  } else {
    console.error(`[DVNT Blog][${ctx.operation}]`, err, ctx)
  }
}

export function addBreadcrumb(
  category: Crumb,
  message: string,
  data?: Record<string, string | number | boolean>,
) {
  sentry()?.addBreadcrumb({ category: `blog.${category}`, message, data, level: 'info' })
}

export function setRouteCtx(ctx: BlogCtx) {
  const s = sentry()
  if (!s) return
  s.setTags({
    app: 'dvnt', package: 'vite-web', area: 'blog',
    ...Object.fromEntries(
      Object.entries(ctx)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ),
  })
}
