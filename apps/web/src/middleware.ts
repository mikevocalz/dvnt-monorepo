// src/middleware.ts
// Subdomain handling: blog.dvntapp.live serves the blog. We rewrite the
// subdomain's "/" and "/<slug>" to internal /posts routes so the public URL
// stays clean (blog.dvntapp.live/my-post) while the app router uses /posts/*.
// All other hosts (the main app) pass through untouched.
import { NextResponse, type NextRequest } from 'next/server'

const BLOG_HOST = 'blog.dvntapp.live'

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const url = req.nextUrl

  const isBlog = host === BLOG_HOST || host.startsWith('blog.localhost')
  if (!isBlog) return NextResponse.next()

  // Let API + Next internals + already-prefixed /posts pass through.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/_next')) {
    return NextResponse.next()
  }
  if (url.pathname === '/') {
    return NextResponse.rewrite(new URL('/posts', req.url))
  }
  if (!url.pathname.startsWith('/posts')) {
    return NextResponse.rewrite(new URL(`/posts${url.pathname}`, req.url))
  }
  return NextResponse.next()
}

export const config = {
  // Run on everything except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
