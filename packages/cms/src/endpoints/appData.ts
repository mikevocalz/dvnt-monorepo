// src/endpoints/appData.ts
// READ-ONLY windows onto the live DVNT app database (the same Supabase the app
// uses). The dashboard's Members/Events/Overview read REAL app data through
// these endpoints — public.users and public.events — while Payload keeps its own
// moderation/CMS tables on its own connection. Strictly SELECT; never writes to
// the app's `public` schema. Staff-auth gated.
import type { Endpoint } from 'payload'
import { forceSuperAdminByEmail } from '../access/roles'

// Separate, lazily-created read-only pool to the app DB (direct connection).
// `pg` is CommonJS; importing it dynamically (with interop) avoids Vite's SSR
// named-export transform breaking on the CJS default.
let pool: any = null
async function appPool(): Promise<any> {
  const url = process.env.APP_DATABASE_URL
  if (!url) return null
  if (!pool) {
    const pg: any = await import('pg')
    const Pool = pg.default?.Pool ?? pg.Pool
    pool = new Pool({ connectionString: url, max: 3, ssl: { rejectUnauthorized: false } })
  }
  return pool
}

// Pool to Payload's OWN database (admin_users live here) — used to copy an app
// user's hash/salt across so they sign into the console with their existing app
// password. Writes only to payload.admin_users; never to the app's `public`.
let adminPoolRef: any = null
async function adminPool(): Promise<any> {
  const url = process.env.DATABASE_URI
  if (!url) return null
  if (!adminPoolRef) {
    const pg: any = await import('pg')
    const Pool = pg.default?.Pool ?? pg.Pool
    adminPoolRef = new Pool({ connectionString: url, max: 2 })
  }
  return adminPoolRef
}

const num = (v: string | null, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : d
}

function paginate(reqUrl: string) {
  const sp = new URL(reqUrl).searchParams
  const page = num(sp.get('page'), 1)
  const limit = Math.min(num(sp.get('limit'), 50), 200)
  const search = (sp.get('search') ?? '').trim()
  const sort = sp.get('sort') ?? ''
  return { page, limit, offset: (page - 1) * limit, search, sort }
}

const wrap = (docs: any[], totalDocs: number, page: number, limit: number) => ({
  docs,
  totalDocs,
  totalPages: Math.max(1, Math.ceil(totalDocs / limit)),
  page,
  limit,
})

export const appMembersEndpoint: Endpoint = {
  path: '/app/members',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    const p = await appPool()
    if (!p) return Response.json(wrap([], 0, 1, 50))
    const { page, limit, offset, search, sort } = paginate(req.url ?? '')

    const where = search ? `where (u.username ilike $1 or u.email ilike $1)` : ''
    const params: any[] = search ? [`%${search}%`] : []
    const orderCol =
      sort.replace('-', '') === 'createdAt' || !sort ? 'u.created_at' : 'u.username'
    const orderDir = sort.startsWith('-') || !sort ? 'desc' : 'asc'

    const total = await p.query(`select count(*)::int as c from public.users u ${where}`, params)
    const avatarSel = 'coalesce(am.sizes_thumbnail_url, am.thumbnail_u_r_l, am.url) as avatar_url'
    const avatarJoin = 'left join public.media am on am.id = u.avatar_id'
    const rows = await p.query(
      `select u.id, u.username, u.email, u.banned_at, u.verified, u.role,
              u.followers_count, u.created_at, ${avatarSel},
              (select count(*)::int from public.content_reports cr
                 where cr.reported_user_id = u.id and cr.status = 'open') as open_reports
         from public.users u ${avatarJoin} ${where}
         order by ${orderCol} ${orderDir} nulls last
         limit ${limit} offset ${offset}`,
      params,
    ).catch(async () =>
      // content_reports.reported_user_id may not exist; fall back without it.
      p.query(
        `select u.id, u.username, u.email, u.banned_at, u.verified, u.role,
                u.followers_count, u.created_at, 0 as open_reports, ${avatarSel}
           from public.users u ${avatarJoin} ${where}
           order by ${orderCol} ${orderDir} nulls last
           limit ${limit} offset ${offset}`,
        params,
      ),
    )

    const docs = rows.rows.map((r: any) => ({
      id: String(r.id),
      username: r.username,
      email: r.email,
      status: r.banned_at ? 'banned' : 'active',
      verified: r.verified,
      role: r.role,
      avatarUrl: r.avatar_url || undefined,
      openReportsAgainst: r.open_reports ?? 0,
      timesBlocked: 0,
      followers: Number(r.followers_count ?? 0),
      createdAt: r.created_at,
    }))
    return Response.json(wrap(docs, total.rows[0]?.c ?? docs.length, page, limit))
  },
}

export const appEventsEndpoint: Endpoint = {
  path: '/app/events',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    const p = await appPool()
    if (!p) return Response.json(wrap([], 0, 1, 50))
    const { page, limit, offset, search } = paginate(req.url ?? '')

    const where = search ? `where e.title ilike $1` : ''
    const params: any[] = search ? [`%${search}%`] : []

    const total = await p.query(`select count(*)::int as c from public.events e ${where}`, params)
    const rows = await p.query(
      `select e.id, e.title, e.visibility, e.start_date, e.total_attendees,
              e.max_attendees, e.location_name, e.location, e.price,
              nullif(coalesce(e.cover_image_url, e.flyer_image_url, e.image), '') as flyer_url,
              coalesce(h.username, e.host_id) as host_name
         from public.events e
         left join public.users h on h.auth_id = e.host_id
         ${where}
         order by e.start_date desc nulls last
         limit ${limit} offset ${offset}`,
      params,
    )

    const docs = rows.rows.map((r: any) => ({
      id: String(r.id),
      title: r.title,
      status: r.visibility === 'public' ? 'published' : (r.visibility ?? 'draft'),
      startsAt: r.start_date,
      host: { username: r.host_name },
      location: r.location_name || r.location,
      flyerUrl: r.flyer_url || undefined,
      capacity: Number(r.max_attendees ?? 0),
      attendees: Number(r.total_attendees ?? 0),
      ticketsSold: Number(r.total_attendees ?? 0),
    }))
    return Response.json(wrap(docs, total.rows[0]?.c ?? docs.length, page, limit))
  },
}

function eventId(req: any): string | undefined {
  return (req.routeParams?.id as string) ?? new URL(req.url ?? '').pathname.split('/').filter(Boolean).pop()
}

// Single real event (so the CS edit screen can load + edit live data).
export const appEventEndpoint: Endpoint = {
  path: '/app/events/:id',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    const id = eventId(req)
    const p = await appPool()
    if (!p || !id) return Response.json(null, { status: 404 })
    const r = await p.query(
      `select e.*, coalesce(h.username, e.host_id) as host_name,
              nullif(coalesce(e.cover_image_url, e.flyer_image_url, e.image), '') as flyer_url
         from public.events e left join public.users h on h.auth_id = e.host_id
        where e.id = $1`,
      [id],
    )
    const e = r.rows[0]
    if (!e) return Response.json(null, { status: 404 })
    return Response.json({
      id: String(e.id),
      title: e.title,
      status: e.visibility === 'public' ? 'published' : (e.visibility ?? 'draft'),
      startsAt: e.start_date,
      endsAt: e.end_date,
      capacity: e.max_attendees,
      location: e.location_name || e.location,
      host: { id: e.host_id, username: e.host_name },
      flyerUrl: e.flyer_url || undefined,
      ticketTiers: [],
      attendees: Number(e.total_attendees ?? 0),
      ticketsSold: Number(e.total_attendees ?? 0),
    })
  },
}

// CS edit: write a small, safe set of columns back to the live event (admin+).
export const appEventUpdateEndpoint: Endpoint = {
  path: '/app/events/:id',
  method: 'patch',
  handler: async (req) => {
    const role = (req.user as any)?.role
    if (!req.user || !['super_admin', 'admin'].includes(role)) {
      return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    }
    const id = eventId(req)
    const p = await appPool()
    if (!p || !id) return Response.json({ errors: [{ message: 'Not found' }] }, { status: 404 })
    const body = (await (req as any).json?.()) ?? {}

    const sets: string[] = []
    const vals: any[] = []
    const add = (col: string, val: any) => {
      if (val !== undefined) {
        vals.push(val === '' ? null : val)
        sets.push(`${col} = $${vals.length}`)
      }
    }
    add('title', body.title)
    add('start_date', body.startsAt)
    add('end_date', body.endsAt)
    add('max_attendees', body.capacity != null ? Number(body.capacity) : undefined)
    add('location_name', body.location)
    if (!sets.length) return Response.json({ doc: { id } })

    vals.push(id)
    try {
      await p.query(`update public.events set ${sets.join(', ')}, updated_at = now() where id = $${vals.length}`, vals)
      return Response.json({ doc: { id } })
    } catch (e: any) {
      return Response.json({ errors: [{ message: e?.message ?? 'update failed' }] }, { status: 500 })
    }
  },
}

// Promote an app user (public.users) to a console role. super_admin only.
//
// This drives the path the whole RBAC is built around (see betterAuthStrategy):
//   1) set public.users.role to the matching app role — this is the source of
//      truth the SSO strategy reads, and it takes effect app-side immediately.
//   2) provision the payload.admin_users row so they appear on the Team list
//      and can log in. If the app user has a Payload-format password (legacy
//      email+password accounts), copy its hash/salt so email+password login
//      works too; otherwise provision via the Local API with a random secret —
//      they sign into /admin through their existing app (Better Auth) session,
//      exactly like the SSO strategy's auto-provision. Critically this means a
//      SOCIAL-login user (Google/Apple, no stored password — the majority) can
//      now be granted a console role, which the old password-copy path rejected.
const ROLES = ['super_admin', 'admin', 'moderator'] as const
// CMS role → public.enum_users_role (must match Members.MEMBER_ROLES exactly).
const APP_ROLE_BY_CMS: Record<string, string> = {
  super_admin: 'Super-Admin',
  admin: 'Admin',
  moderator: 'Moderator',
}
const randomSecret = () =>
  Array.from({ length: 48 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('')

export const appPromoteEndpoint: Endpoint = {
  path: '/app/promote',
  method: 'post',
  handler: async (req) => {
    if ((req.user as any)?.role !== 'super_admin') {
      return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    }
    const body = (await (req as any).json?.()) ?? {}
    const userId = body.userId != null ? String(body.userId) : ''
    let role = String(body.role ?? 'moderator')
    if (!userId) return Response.json({ errors: [{ message: 'userId is required' }] }, { status: 400 })
    if (!(ROLES as readonly string[]).includes(role)) return Response.json({ errors: [{ message: 'invalid role' }] }, { status: 400 })

    const app = await appPool()
    if (!app) return Response.json({ errors: [{ message: 'App DB unavailable' }] }, { status: 503 })

    const avatarSel = 'coalesce(am.sizes_thumbnail_url, am.thumbnail_u_r_l, am.url) as avatar_url'
    const r = await app.query(
      `select u.email, u.username, u.first_name, u.last_name, u.hash, u.salt, ${avatarSel}
         from public.users u
         left join public.media am on am.id = u.avatar_id
        where u.id = $1 limit 1`,
      [userId],
    )
    const u = r.rows[0]
    if (!u) return Response.json({ errors: [{ message: 'app user not found' }] }, { status: 404 })
    if (!u.email) return Response.json({ errors: [{ message: 'app user has no email' }] }, { status: 422 })

    const email = String(u.email).toLowerCase()
    // Pinned canonical accounts are always super_admin.
    role = forceSuperAdminByEmail(email) ?? role
    const appRole = APP_ROLE_BY_CMS[role]
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || u.email
    const avatarUrl = u.avatar_url || null
    const hasPassword = Boolean(u.hash && u.salt)

    try {
      // 1) Source of truth: the app role. Drives SSO access + app-side role.
      await app.query(
        `update public.users set role = $1::public.enum_users_role, updated_at = now() where id = $2`,
        [appRole, userId],
      )

      // 2) Provision the console account.
      if (hasPassword) {
        // Legacy password account — copy hash/salt so email+password login works.
        const adm = await adminPool()
        if (!adm) return Response.json({ errors: [{ message: 'Console DB unavailable' }] }, { status: 503 })
        const existing = await adm.query(`select id from payload.admin_users where lower(email) = $1 limit 1`, [email])
        if (existing.rows[0]) {
          await adm.query(
            `update payload.admin_users set role=$1, name=$2, avatar_url=$3, hash=$4, salt=$5, updated_at=now() where id=$6`,
            [role, name, avatarUrl, u.hash, u.salt, existing.rows[0].id],
          )
        } else {
          await adm.query(
            `insert into payload.admin_users (email, role, name, avatar_url, hash, salt, created_at, updated_at)
             values ($1, $2, $3, $4, $5, $6, now(), now())`,
            [email, role, name, avatarUrl, u.hash, u.salt],
          )
        }
      } else {
        // Social-login account (no stored password) — provision via the Local
        // API (Payload hashes a random secret); they sign in via their app
        // session through the SSO strategy. Idempotent on email.
        const found = await req.payload.find({
          collection: 'admin-users', where: { email: { equals: email } }, limit: 1, overrideAccess: true,
        })
        if (found.docs[0]) {
          await req.payload.update({
            collection: 'admin-users', id: found.docs[0].id,
            data: { role, name, avatarUrl }, overrideAccess: true,
          })
        } else {
          await req.payload.create({
            collection: 'admin-users',
            data: { email, name, role, avatarUrl, password: randomSecret() } as any,
            overrideAccess: true,
          })
        }
      }
      return Response.json({ ok: true, email, role, name, avatarUrl, loginMethod: hasPassword ? 'password' : 'app-session' })
    } catch (e: any) {
      return Response.json({ errors: [{ message: e?.message ?? 'promote failed' }] }, { status: 500 })
    }
  },
}

// Mirror live app data (public.users / public.events) INTO Payload's own
// `members` / `events` collections so they're browsable/editable in the CMS.
// super_admin only. Upserts on appUserId / appEventId (idempotent — re-running
// never duplicates). Uses the Local API so columns/relationships are handled
// correctly. Critically: NEVER overwrites a member's moderation `status` on
// update (that's Payload-owned), so a sync can't undo a ban or fire the
// status-change side effects (session revoke / ban-list). New members get their
// initial status from the app (banned_at → 'banned').
const eventStatusFromVisibility = (v?: string) => (v === 'public' ? 'published' : 'draft')

export const appSyncEndpoint: Endpoint = {
  path: '/app/sync',
  method: 'post',
  handler: async (req) => {
    if ((req.user as any)?.role !== 'super_admin') {
      return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    }
    const app = await appPool()
    if (!app) return Response.json({ errors: [{ message: 'App DB unavailable' }] }, { status: 503 })
    const payload = req.payload

    try {
      // ── Members ──────────────────────────────────────────────────────────
      const avatarSel = 'coalesce(am.sizes_thumbnail_url, am.thumbnail_u_r_l, am.url) as avatar_url'
      const users = await app.query(
        `select u.id, u.auth_id, u.username, u.email, u.banned_at, u.role,
                u.first_name, u.last_name, u.bio, u.location, u.website, u.gender, ${avatarSel}
           from public.users u
           left join public.media am on am.id = u.avatar_id`,
      )
      const userIdToMemberId = new Map<string, string | number>()
      const authIdToUserId = new Map<string, string>()
      let mCreated = 0, mUpdated = 0
      for (const u of users.rows) {
        const appUserId = String(u.id)
        if (u.auth_id) authIdToUserId.set(String(u.auth_id), appUserId)
        const appFields = {
          username: u.username || appUserId,
          email: u.email || undefined,
          avatarUrl: u.avatar_url || undefined,
          appUserId,
          // Mirror the app role (public.users.role) so the dropdown shows it. The
          // write-back hook keeps CMS edits → public.users.role, so this stays in
          // sync; skip the echo write-back during sync.
          role: u.role || 'Basic',
          // Editable app-profile fields (write back via onMemberProfileChange).
          firstName: u.first_name || undefined,
          lastName: u.last_name || undefined,
          bio: u.bio || undefined,
          location: u.location || undefined,
          website: u.website || undefined,
          gender: u.gender || undefined,
        }
        const existing = await payload.find({
          collection: 'members', where: { appUserId: { equals: appUserId } }, limit: 1, overrideAccess: true,
        })
        if (existing.docs[0]) {
          // App-sourced fields only — leave moderation `status` untouched.
          await payload.update({ collection: 'members', id: existing.docs[0].id, data: appFields, overrideAccess: true, context: { skipRoleWriteBack: true } })
          userIdToMemberId.set(appUserId, existing.docs[0].id)
          mUpdated++
        } else {
          const created = await payload.create({
            collection: 'members',
            data: { ...appFields, status: u.banned_at ? 'banned' : 'active' },
            overrideAccess: true,
            context: { skipRoleWriteBack: true },
          })
          userIdToMemberId.set(appUserId, created.id)
          mCreated++
        }
      }

      // ── Ticket types (tiers) — for event.ticketTiers + ticket tier names ──
      const types = await app.query(
        `select id, event_id, name, price_cents, quantity_total, quantity_sold from public.ticket_types`,
      )
      const tierNameById = new Map<string, string>()
      const tiersByEvent = new Map<string, any[]>()
      for (const tt of types.rows) {
        tierNameById.set(String(tt.id), tt.name || 'General')
        const arr = tiersByEvent.get(String(tt.event_id)) ?? []
        arr.push({
          name: tt.name || 'General',
          priceCents: Number(tt.price_cents ?? 0),
          quantity: Number(tt.quantity_total ?? 0),
          soldCount: Number(tt.quantity_sold ?? 0),
        })
        tiersByEvent.set(String(tt.event_id), arr)
      }

      // ── Events ───────────────────────────────────────────────────────────
      const events = await app.query(
        `select e.id, e.title, e.description, e.visibility, e.start_date, e.end_date,
                e.max_attendees, e.location_name, e.location, e.host_id, e.total_attendees
           from public.events e`,
      )
      const eventByAppId = new Map<string, string | number>()
      let eCreated = 0, eUpdated = 0
      for (const e of events.rows) {
        const appEventId = String(e.id)
        const hostUserId = e.host_id ? authIdToUserId.get(String(e.host_id)) : undefined
        const hostMember = hostUserId ? userIdToMemberId.get(hostUserId) : undefined
        const tiers = tiersByEvent.get(appEventId)
        const data: Record<string, any> = {
          title: e.title || 'Untitled event',
          appEventId,
          description: e.description || undefined,
          status: eventStatusFromVisibility(e.visibility),
          startsAt: e.start_date || undefined,
          endsAt: e.end_date || undefined,
          capacity: e.max_attendees != null ? Number(e.max_attendees) : undefined,
          location: e.location_name || e.location || undefined,
          host: hostMember,
          attendees: Number(e.total_attendees ?? 0),
          ticketsSold: Number(e.total_attendees ?? 0),
        }
        const existing = await payload.find({
          collection: 'events', where: { appEventId: { equals: appEventId } }, limit: 1, overrideAccess: true,
        })
        if (existing.docs[0]) {
          // Populate tiers only if none yet (don't clobber CMS edits to tiers).
          if (tiers && !(existing.docs[0].ticketTiers?.length)) data.ticketTiers = tiers
          // data is dynamic app-sync payload (Record<string,any>) — cast past
          // Payload's strict create/update data overloads.
          await payload.update({ collection: 'events', id: existing.docs[0].id, data: data as any, overrideAccess: true, context: { skipEventWriteBack: true } })
          eventByAppId.set(appEventId, existing.docs[0].id)
          eUpdated++
        } else {
          if (tiers) data.ticketTiers = tiers
          const created = await payload.create({ collection: 'events', data: data as any, overrideAccess: true, context: { skipEventWriteBack: true } })
          eventByAppId.set(appEventId, created.id)
          eCreated++
        }
      }

      // ── Tickets (per attendee) ───────────────────────────────────────────
      const STATUSES = new Set(['valid', 'checked_in', 'cancelled', 'refunded', 'transferred', 'pending'])
      const tickets = await app.query(
        `select id, event_id, ticket_type_id, user_id, status, qr_token,
                checked_in_at, attendee_name, guest_name, guest_email, created_at
           from public.tickets`,
      )
      let tCreated = 0, tUpdated = 0
      for (const t of tickets.rows) {
        const appTicketId = String(t.id)
        const holderUserId = t.user_id ? (authIdToUserId.get(String(t.user_id)) ?? String(t.user_id)) : undefined
        const holderMember = holderUserId ? userIdToMemberId.get(holderUserId) : undefined
        const status = t.checked_in_at ? 'checked_in' : (STATUSES.has(String(t.status)) ? String(t.status) : 'valid')
        const appFields = {
          event: eventByAppId.get(String(t.event_id)),
          holder: holderMember,
          tier: t.ticket_type_id ? tierNameById.get(String(t.ticket_type_id)) : undefined,
          status,
          guestEmail: t.guest_email || undefined,
          qrToken: t.qr_token || undefined,
          purchasedAt: t.created_at || undefined,
          appTicketId,
        }
        const existing = await payload.find({
          collection: 'tickets', where: { appTicketId: { equals: appTicketId } }, limit: 1, overrideAccess: true,
        })
        if (existing.docs[0]) {
          // Preserve CS-edited attendeeName + quantity across re-syncs.
          await payload.update({ collection: 'tickets', id: existing.docs[0].id, data: appFields as any, overrideAccess: true })
          tUpdated++
        } else {
          await payload.create({
            collection: 'tickets',
            data: { ...appFields, attendeeName: t.attendee_name || t.guest_name || undefined, quantity: 1 } as any,
            overrideAccess: true,
          })
          tCreated++
        }
      }

      return Response.json({
        ok: true,
        members: { created: mCreated, updated: mUpdated, total: mCreated + mUpdated },
        events: { created: eCreated, updated: eUpdated, total: eCreated + eUpdated },
        tickets: { created: tCreated, updated: tUpdated, total: tCreated + tUpdated },
      })
    } catch (e: any) {
      return Response.json({ errors: [{ message: e?.message ?? 'sync failed' }] }, { status: 500 })
    }
  },
}

// Manual verification: mark an app user as verified (writes public.users.verified)
// — the same "manual verify" the mobile onboarding offers, exposed to staff so
// they can confirm a user who's stuck. admin+ only. Pass { verified:false } to
// un-verify. Writes ONLY the boolean to the app DB.
export const appVerifyEndpoint: Endpoint = {
  path: '/app/verify',
  method: 'post',
  handler: async (req) => {
    const role = (req.user as any)?.role
    if (!req.user || !['super_admin', 'admin'].includes(role)) {
      return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    }
    const body = (await (req as any).json?.()) ?? {}
    const userId = body.userId != null ? String(body.userId) : ''
    const verified = body.verified === false ? false : true
    if (!userId) return Response.json({ errors: [{ message: 'userId is required' }] }, { status: 400 })
    const p = await appPool()
    if (!p) return Response.json({ errors: [{ message: 'App DB unavailable' }] }, { status: 503 })
    try {
      const r = await p.query('update public.users set verified = $1 where id = $2 returning id, verified', [verified, userId])
      if (!r.rows[0]) return Response.json({ errors: [{ message: 'app user not found' }] }, { status: 404 })
      return Response.json({ ok: true, userId, verified: r.rows[0].verified })
    } catch (e: any) {
      return Response.json({ errors: [{ message: e?.message ?? 'verify failed' }] }, { status: 500 })
    }
  },
}

export const appStatsEndpoint: Endpoint = {
  path: '/app/stats',
  method: 'get',
  handler: async (req) => {
    if (!req.user) return Response.json({ errors: [{ message: 'Forbidden' }] }, { status: 403 })
    const p = await appPool()
    if (!p) return Response.json({ members: 0, banned: 0, events: 0, openReports: 0, underReview: 0 })
    const q = async (text: string) => {
      try {
        return (await p.query(text)).rows[0]?.c ?? 0
      } catch {
        return 0
      }
    }
    const [members, banned, events, openReports] = await Promise.all([
      q('select count(*)::int as c from public.users'),
      q('select count(*)::int as c from public.users where banned_at is not null'),
      q('select count(*)::int as c from public.events'),
      q(`select count(*)::int as c from public.content_reports where status = 'open'`),
    ])
    return Response.json({ members, banned, events, openReports, underReview: 0 })
  },
}
