// src/dashboard/lib/payload.ts
// Headless Payload REST client. The dashboard is served by the same app as the
// Payload API, so requests are same-origin (`/api/...`) with cookie auth — no
// CORS, no token plumbing. Override with VITE_PAYLOAD_URL only if the dashboard
// is ever hosted on a different origin than Payload.
export type Role = 'super_admin' | 'admin' | 'moderator'

const BASE =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PAYLOAD_URL) || ''

type Query = Record<string, string | number | undefined>

const qs = (q: Query) =>
  Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function req<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    // Surface the server's reason (Payload returns `{ errors: [{ message }] }`).
    let message = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      message = body?.errors?.[0]?.message || body?.message || message
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, message)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export type Paginated<T> = {
  docs: T[]
  totalDocs: number
  totalPages: number
  page: number
  limit: number
}

export const payload = {
  me: () => req<{ user: { id: string; email: string; role: Role } | null }>('/admin-users/me'),

  login: (email: string, password: string) =>
    req('/admin-users/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => req('/admin-users/logout', { method: 'POST' }),

  find: <T = any>(
    collection: string,
    q: { search?: string; page?: number; limit?: number; sort?: string; where?: any } = {},
  ) => {
    const params: Query = { page: q.page, limit: q.limit, sort: q.sort }
    // Payload's `where` is encoded via qs; for simple search we hit a couple of
    // common text fields. The caller can pass a full `where` for precision.
    const whereStr = q.where
      ? Object.entries(flattenWhere(q.where))
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
      : q.search
        ? `where[or][0][username][contains]=${encodeURIComponent(q.search)}&where[or][1][email][contains]=${encodeURIComponent(q.search)}&where[or][2][title][contains]=${encodeURIComponent(q.search)}`
        : ''
    const query = [qs(params), whereStr].filter(Boolean).join('&')
    return req<Paginated<T>>(`/${collection}${query ? `?${query}` : ''}`)
  },

  findById: <T = any>(collection: string, id: string) => req<T>(`/${collection}/${id}`),

  count: (collection: string, where?: any) => {
    const whereStr = where
      ? Object.entries(flattenWhere(where))
          .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    return req<{ totalDocs: number }>(`/${collection}/count${whereStr ? `?${whereStr}` : ''}`)
  },

  update: <T = any>(collection: string, id: string, patch: Record<string, unknown>) =>
    req<{ doc: T }>(`/${collection}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  remove: (collection: string, id: string) =>
    req(`/${collection}/${id}`, { method: 'DELETE' }),

  // Read-only windows onto the live app DB (real members/events/stats).
  app: {
    members: (q: { search?: string; page?: number; limit?: number; sort?: string } = {}) =>
      req<Paginated<any>>(`/app/members?${qs({ ...q })}`),
    events: (q: { search?: string; page?: number; limit?: number } = {}) =>
      req<Paginated<any>>(`/app/events?${qs({ ...q })}`),
    event: (id: string) => req<any>(`/app/events/${id}`),
    updateEvent: (id: string, patch: Record<string, unknown>) =>
      req<{ doc: any }>(`/app/events/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    stats: () => req<{ members: number; banned: number; events: number; openReports: number; underReview: number }>('/app/stats'),
    // Grant an app user a console role, reusing their existing app password.
    promote: (userId: string, role: Role) =>
      req<{ ok: boolean; email: string; role: Role; name: string; avatarUrl?: string | null }>('/app/promote', {
        method: 'POST',
        body: JSON.stringify({ userId, role }),
      }),
  },
}

// Flatten a nested `where` object into Payload's bracketed query keys.
function flattenWhere(where: any, prefix = 'where'): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(where)) {
    const key = `${prefix}[${k}]`
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenWhere(v, key))
    else out[key] = String(v)
  }
  return out
}
