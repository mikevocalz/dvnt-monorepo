import type { AdminUser } from '../payload-types'
import { randomUUID } from 'node:crypto'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { APIError, commitTransaction, initTransaction, killTransaction,
  type Access, type CollectionBeforeChangeHook, type Endpoint, type PayloadRequest } from 'payload'

// Always use Payload's authenticated staff ID. App IDs, author IDs, names and
// email addresses belong to different namespaces and never establish ownership.
export function staffAccount(req: Pick<PayloadRequest, 'user'>) {
  const user = req.user as (AdminUser & { collection?: string }) | null | undefined
  return user?.collection === 'admin-users' &&
    ['super_admin', 'admin', 'moderator'].includes(user.role) ? user : null
}
export const canEditBylines = (req: Pick<PayloadRequest, 'user'>) =>
  ['super_admin', 'admin'].includes(staffAccount(req)?.role ?? '')
export const authorStaffAccess = ({ req }: { req: PayloadRequest }) => Boolean(staffAccount(req))
export const authorEditorAccess = ({ req }: { req: PayloadRequest }) => canEditBylines(req)
export const updateAuthorAccess: Access = ({ req }) => {
  const user = staffAccount(req)
  if (!user) return false
  return canEditBylines(req) || { user: { equals: user.id } }
}
export function relationshipID(value: any): string | number | undefined {
  const id = value && typeof value === 'object' ? value.id : value
  return typeof id === 'string' || typeof id === 'number' ? id : undefined
}
const sameID = (a: unknown, b: unknown) =>
  relationshipID(a) != null && String(relationshipID(a)) === String(relationshipID(b))
const ids = (value: unknown): string[] => Array.isArray(value) ? value.map(v => String(relationshipID(v))) : []
const sameByline = (a: unknown, b: unknown) => JSON.stringify(ids(a)) === JSON.stringify(ids(b))

// Serialize all profile provisioning/linking on the existing account row. The
// outer Payload write already owns a transaction; standalone endpoints create
// one. An autocommit lock would be ineffective, so fail closed without a tx.
// No schema migration, uniqueness index or legacy author backfill is needed.
async function lockAccount(req: PayloadRequest, accountID: string | number) {
  const db = req.payload.db as unknown as PostgresAdapter
  const transactionID = await req.transactionID
  const tx = transactionID == null ? undefined : db.sessions[transactionID]?.db
  const table = db.tables.admin_users
  if (!tx || !table) throw new APIError('Author profiles require an active database transaction.', 503)
  const result = await db.execute({ db: tx, sql: sql`SELECT ${table.id} FROM ${table} WHERE ${table.id} = ${accountID} FOR UPDATE` })
  if (result.rows.length !== 1) throw new APIError('The linked staff account does not exist.', 400)
}
async function linkedAuthors(req: PayloadRequest, accountID: string | number) {
  return req.payload.find({ collection: 'authors', where: { user: { equals: accountID } },
    sort: 'id', limit: 1, depth: 0, overrideAccess: true, req })
}

export async function ensureOwnAuthor(req: PayloadRequest) {
  const user = staffAccount(req)
  if (!user) throw new APIError('Sign in with a staff account to edit your author profile.', 403)
  await lockAccount(req, user.id)
  const existing = (await linkedAuthors(req, user.id)).docs[0]
  if (existing) return existing
  return req.payload.create({ collection: 'authors', overrideAccess: true, req, depth: 0,
    data: { user: user.id, name: user.name?.trim() || 'Staff writer',
      slug: `writer-${user.id}-${randomUUID()}` } })
}

export const prepareAuthorProfile: CollectionBeforeChangeHook = async ({ data, operation, originalDoc, req }) => {
  const actor = staffAccount(req)
  for (const value of [data.profileUrl, data.socials?.website]) {
    if (value == null || value === '') continue
    let valid = false
    try { valid = ['http:', 'https:'].includes(new URL(String(value)).protocol) } catch { /* invalid URL */ }
    if (!valid) throw new APIError('Author links must be full http:// or https:// URLs.', 400)
  }
  const originalID = relationshipID(originalDoc?.user)
  let accountID = relationshipID(data.user ?? originalDoc?.user)
  if (actor && !canEditBylines(req)) {
    if (operation === 'update' && !sameID(originalID, actor.id)) throw new APIError('You can only edit your own author profile.', 403)
    // Field access may strip a forged link before this hook. Either way the
    // stored association always comes from authentication, never the request.
    accountID = actor.id
    data.user = actor.id
  } else if (operation === 'create' && accountID == null && actor) {
    accountID = actor.id
    data.user = actor.id
  }
  // Preserve unlinked legacy bylines on ordinary edits. They are not silently
  // claimed by matching a name/email or rewritten when an old post is saved.
  if (accountID == null) {
    if (operation === 'create') throw new APIError('Choose a linked staff account for this author.', 400)
    if (originalID != null) throw new APIError('An existing author account link cannot be removed.', 400)
    return data
  }
  if (data.user === null && originalID != null) throw new APIError('An existing author account link cannot be removed.', 400)
  await lockAccount(req, accountID)
  if (operation === 'create' || !sameID(originalID, accountID)) {
    const existing = (await linkedAuthors(req, accountID)).docs[0]
    if (existing && !sameID(existing.id, originalDoc?.id))
      throw new APIError('This account already has an author profile. Edit the existing profile instead.', 409)
  }
  const account = await req.payload.findByID({ collection: 'admin-users', id: accountID,
    depth: 0, overrideAccess: true, req })
  if (!['super_admin', 'admin', 'moderator'].includes(account.role))
    throw new APIError('Choose an existing staff account.', 400)
  data.user = account.id
  if (!String(data.name ?? originalDoc?.name ?? '').trim()) data.name = account.name?.trim() || 'Staff writer'
  // This is a fallback, not an editorial override. Never copy private email.
  data.avatarUrl = account.avatarUrl || null
  return data
}

export const enforcePostAttribution: CollectionBeforeChangeHook = async ({ data, operation, originalDoc, req }) => {
  const user = staffAccount(req)
  // Trusted, server-side imports without an authenticated user retain their
  // explicit legacy attribution; HTTP creation still requires staff access.
  if (!user) return data
  if (operation === 'create') {
    data.createdBy = user.id
    const author = await ensureOwnAuthor(req)
    if (!canEditBylines(req) || !Array.isArray(data.authors) || data.authors.length === 0) data.authors = [author.id]
    if (!canEditBylines(req)) data.contributors = []
  } else {
    data.createdBy = relationshipID(originalDoc?.createdBy) ?? null
    if (data.authors === undefined) data.authors = originalDoc?.authors ?? []
    if (!canEditBylines(req)) {
      if (Array.isArray(data.authors) && data.authors.length === 0) data.authors = originalDoc?.authors ?? []
      data.contributors = originalDoc?.contributors ?? []
      if (!sameByline(data.authors, originalDoc?.authors)) {
        const author = await ensureOwnAuthor(req)
        if (!sameByline(data.authors, [author.id]))
          throw new APIError('You can set your own byline. An editor must change other author credits.', 403)
      }
    }
  }
  return data
}

export const authorsProfileEndpoint: Endpoint = {
  path: '/me/profile', method: 'post',
  handler: async req => {
    if (!staffAccount(req)) return Response.json({ errors: [{ message: 'Staff sign-in is required.' }] }, { status: 403 })
    // Require a non-simple request; the admin fetch supplies JSON. This prevents
    // cross-site HTML forms from provisioning a profile through a cookie.
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return Response.json({ errors: [{ message: 'Send an application/json request.' }] }, { status: 415 })
    const ownsTransaction = await initTransaction(req)
    try {
      const author = await ensureOwnAuthor(req)
      if (ownsTransaction) await commitTransaction(req)
      return Response.json({ author: { id: author.id, name: author.name },
        editURL: `${req.payload.config.routes.admin}/collections/authors/${encodeURIComponent(author.id)}` })
    } catch (error) {
      if (ownsTransaction) await killTransaction(req)
      throw error
    }
  },
}
