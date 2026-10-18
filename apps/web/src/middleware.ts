// Route public blog traffic separately from the canonical app/admin origin.
// Staff authentication is ALWAYS enforced by Payload's Better Auth strategy;
// these redirects only choose the right login origin and preserve the editor URL.
import { NextResponse, type NextRequest } from 'next/server'

const BLOG_HOST = 'blog.dvntapp.live'

const isAdminPath = (path: string) => path === '/admin' || path.startsWith('/admin/')
const isAppAuthPath = (path: string) => path === '/auth' || path.startsWith('/auth/')
const isConsolePath = (path: string) => path === '/console' || path.startsWith('/console/')

function hasAppSessionCookie(req: NextRequest): boolean {
  return (
    req.cookies.has('__Secure-better-auth.session_token') ||
    req.cookies.has('better-auth.session_token')
  )
}

function hasPayloadSessionCookie(req: NextRequest): boolean {
  // Preserve a signed-in legacy CMS session and the explicitly opted-in local
  // emergency login. Cookie presence is NOT authorization: Payload verifies it.
  return req.cookies.getAll().some(({ name }) => name === 'payload-token' || name.endsWith('-payload-token'))
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? ''
  const url = req.nextUrl
  const path = url.pathname
  const isBlog = host === BLOG_HOST || host.startsWith('blog.localhost')

  if (isBlog) {
    // Login cookies are host-only on dvntapp.live, not blog.dvntapp.live.
    // Without this, /admin gets rewritten to /posts/admin (a 404) and a blog
    // login would mint a different browser session on the wrong hostname.
    if (isAdminPath(path) || isAppAuthPath(path) || isConsolePath(path)) {
      const appOrigin = host.startsWith('blog.localhost')
        ? `${url.protocol}//localhost:${url.port || '3000'}`
        : 'https://dvntapp.live'
      return NextResponse.redirect(new URL(`${path}${url.search}`, appOrigin))
    }

    // Leave public APIs and existing article routes alone; the blog needs its
    // public Payload endpoints too, not an HTML article rewrite.
    if (
      path.startsWith('/api') ||
      path.startsWith('/_next') ||
      path === '/payload-api' ||
      path.startsWith('/payload-api/') ||
      path.startsWith('/posts')
    ) {
      return NextResponse.next()
    }
    if (path === '/') return NextResponse.rewrite(new URL('/posts', req.url))
    return NextResponse.rewrite(new URL(`/posts${path}`, req.url))
  }

  // Send app staff to the SAME Better Auth login the main DVNT app uses.
  // Direct editor deep links survive the round-trip. Never redirect the
  // explicit break-glass Payload login or an existing Payload session.
  if (
    isAdminPath(path) &&
    !(path === '/admin/login' && url.searchParams.get('local') === '1') &&
    !hasAppSessionCookie(req) &&
    !hasPayloadSessionCookie(req)
  ) {
    const returnTo =
      path === '/admin/login' ? '/admin/collections/posts' : `${path}${url.search}`
    const login = new URL('/auth/login', req.url)
    login.searchParams.set('returnTo', returnTo)
    return NextResponse.redirect(login)
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
