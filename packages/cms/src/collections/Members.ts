// src/collections/Members.ts — the moderation view of DVNT app users.
// Mirrors the app's `profiles` (linked by `appUserId`) and carries the
// moderation `status` enum the dashboard acts on. Status changes fan out
// through the `onStatusChange` hook (ban_list + moderation_actions + session
// revocation). Reports drive `openReportsAgainst` via `onReportChange`.
import type { CollectionConfig } from 'payload'
import { canModerate, isAdminPlus } from '../access/roles'
import { onStatusChange } from './hooks/moderation'

export const MEMBER_STATUSES = [
  'active',
  'under_review',
  'warned',
  'suspended',
  'shadow_banned',
  'banned',
] as const

export const Members: CollectionConfig = {
  slug: 'members',
  dbName: 'members',
  access: {
    read: canModerate, // all staff can view
    update: canModerate, // moderators+ can change status
    create: isAdminPlus,
    delete: isAdminPlus,
  },
  admin: {
    useAsTitle: 'username',
    defaultColumns: ['avatarUrl', 'username', 'email', 'status', 'openReportsAgainst', 'createdAt'],
    listSearchableFields: ['username', 'email'],
  },
  hooks: {
    afterChange: [onStatusChange],
  },
  fields: [
    { name: 'username', type: 'text', index: true, required: true },
    { name: 'email', type: 'email', index: true },
    {
      name: 'avatarUrl',
      type: 'text',
      label: 'Avatar',
      admin: { components: { Cell: '@dvnt/cms/components/AvatarCell' } },
    },
    // Link back to the app's auth/profiles row so a ban can revoke app sessions.
    { name: 'appUserId', type: 'text', index: true, admin: { description: 'Supabase/Better Auth user id' } },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      index: true,
      options: MEMBER_STATUSES.map((v) => ({ label: v.replace('_', ' '), value: v })),
    },
    // Last reason supplied by the moderator — read by onStatusChange to stamp
    // the audit row + ban_list entry. Not a historical log (that's
    // moderation_actions); just the most recent reason.
    { name: 'lastModerationReason', type: 'textarea', admin: { position: 'sidebar' } },
    { name: 'suspendedUntil', type: 'date', admin: { position: 'sidebar' } },
    // Denormalized counters the dashboard columns read cheaply.
    { name: 'openReportsAgainst', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    { name: 'timesBlocked', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    // Ban-evasion signals (hashed into ban_list on ban).
    { name: 'lastIp', type: 'text', admin: { position: 'sidebar', readOnly: true } },
    { name: 'appleSub', type: 'text', admin: { position: 'sidebar', readOnly: true } },
    { name: 'deviceId', type: 'text', admin: { position: 'sidebar', readOnly: true } },
  ],
}
