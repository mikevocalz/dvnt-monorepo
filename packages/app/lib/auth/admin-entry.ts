import { loginPathWithReturn, safeReturnTo } from './return-to.ts'

type Search = Record<string, string | string[] | undefined>
export const adminPath = (segments: string[] = []) => '/admin' + segments.map(s => `/${encodeURIComponent(s)}`).join('')
export const isLocalAdminRecovery = (path: string, search: Search) => path === '/admin/login' && search.local === '1'

export async function resolveAdminEntry(
  route: { path: string; search: Search },
  server: { authenticate: () => Promise<unknown | null>; readAppSession: () => Promise<unknown | null> },
): Promise<string | null> {
  if (isLocalAdminRecovery(route.path, route.search) || route.path === '/admin/logout') return null
  const user = await server.authenticate()
  const appSession = user ? null : await server.readAppSession()
  return adminLoginRedirect({ ...route, hasAdminUser: Boolean(user), hasActiveAppSession: Boolean(appSession) })
}

/** Called only after Payload's server authentication, never from cookie presence. */
export function adminLoginRedirect(args: {
  path: string
  search: Search
  hasAdminUser: boolean
  hasActiveAppSession: boolean
}): string | null {
  const { path, search, hasAdminUser, hasActiveAppSession } = args
  // Active app users without CMS authorization keep Payload's denial/fallback;
  // sending them through app login again would produce an authenticated loop.
  if (hasAdminUser || hasActiveAppSession || isLocalAdminRecovery(path, search) || path === '/admin/logout') return null
  let returnTo = path
  if (path === '/admin/login') {
    returnTo = safeReturnTo(typeof search.redirect === 'string' ? search.redirect : '', '/admin/collections/posts')
    const pathname = returnTo.split(/[?#]/, 1)[0]
    if (!(pathname === '/admin' || pathname.startsWith('/admin/')) ||
        ['/admin/login', '/admin/logout'].includes(pathname)) returnTo = '/admin/collections/posts'
  } else {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(search)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item)
    }
    if (query.size) returnTo += `?${query}`
  }
  return loginPathWithReturn(returnTo)
}
