// src/collections/hooks/banList.ts
// Ban-evasion helpers. A ban fans the member's identifying keys (email, name,
// IP, Apple sub, device) into the locked `ban_list` collection as one-way
// hashes; reinstatement lifts them. These writes run with `overrideAccess`
// because `ban_list` is super-admin-only for *direct* edits — the server trusts
// its own moderation logic (see roles.ts / onStatusChange).
import crypto from 'node:crypto'
import type { Payload } from 'payload'

export type BanKeyType = 'email' | 'name' | 'ip' | 'apple_sub' | 'device'

const SALT = process.env.BAN_LIST_SALT ?? 'dvnt-ban-list'

export const hashKey = (type: BanKeyType, value: string): string =>
  crypto.createHash('sha256').update(`${type}:${SALT}:${value.trim().toLowerCase()}`).digest('hex')

type KeyInput = { type: BanKeyType; value?: string | null }

/** Collect the candidate ban keys present on a member record. */
export const keysForMember = (member: any): KeyInput[] => [
  { type: 'email', value: member?.email },
  { type: 'name', value: member?.username },
  { type: 'ip', value: member?.lastIp },
  { type: 'apple_sub', value: member?.appleSub },
  { type: 'device', value: member?.deviceId },
]

/** Fan a ban into ban_list (idempotent: skips keys already active). */
export const addBanKeys = async (
  payload: Payload,
  member: any,
  reason?: string,
): Promise<void> => {
  for (const { type, value } of keysForMember(member)) {
    if (!value) continue
    const keyHash = hashKey(type, String(value))
    const existing = await payload.find({
      collection: 'ban-list',
      where: { and: [{ keyHash: { equals: keyHash } }, { active: { equals: true } }] },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.totalDocs > 0) continue
    await payload.create({
      collection: 'ban-list',
      data: { keyType: type, keyHash, member: member.id, active: true, reason },
      overrideAccess: true,
    })
  }
}

/** Lift all active ban_list keys for a member (reinstatement). */
export const liftBanKeys = async (payload: Payload, memberId: string | number): Promise<void> => {
  const active = await payload.find({
    collection: 'ban-list',
    where: { and: [{ member: { equals: memberId } }, { active: { equals: true } }] },
    limit: 1000,
    overrideAccess: true,
  })
  for (const doc of active.docs) {
    await payload.update({
      collection: 'ban-list',
      id: doc.id,
      data: { active: false },
      overrideAccess: true,
    })
  }
}

/** Is any of this signup's keys present and active in the ban list? (fails closed) */
export const isBanned = async (payload: Payload, candidate: any): Promise<boolean> => {
  for (const { type, value } of keysForMember(candidate)) {
    if (!value) continue
    const hit = await payload.find({
      collection: 'ban-list',
      where: {
        and: [{ keyHash: { equals: hashKey(type, String(value)) } }, { active: { equals: true } }],
      },
      limit: 1,
      overrideAccess: true,
    })
    if (hit.totalDocs > 0) return true
  }
  return false
}
