// src/collections/Members.ts — the moderation view of DVNT app users.
// Mirrors the app's `profiles` (linked by `appUserId`) and carries the
// moderation `status` enum the dashboard acts on. Status changes fan out
// through the `onStatusChange` hook (ban_list + moderation_actions + session
// revocation). Reports drive `openReportsAgainst` via `onReportChange`.
import type { CollectionConfig } from 'payload'
import { canModerate, isAdminPlus, fieldAdminPlus } from '../access/roles'
import { onStatusChange } from './hooks/moderation'
import { onMemberRoleChange, onMemberProfileChange, onMemberAvatarChange } from './hooks/role'

// App role values — MUST match public.enum_users_role exactly (the write-back
// hook casts these straight into that enum).
export const MEMBER_ROLES = ['Super-Admin', 'Admin', 'Moderator', 'Basic'] as const

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
    defaultColumns: ['avatarUrl', 'username', 'email', 'role', 'status', 'openReportsAgainst', 'createdAt'],
    listSearchableFields: ['username', 'email'],
  },
  hooks: {
    afterChange: [onStatusChange, onMemberRoleChange, onMemberProfileChange, onMemberAvatarChange],
  },
  fields: [
    { name: 'username', type: 'text', index: true, required: true },
    { name: 'email', type: 'email', index: true },
    // App role. Editing this writes back to public.users.role (onMemberRoleChange)
    // and — for Moderator/Admin/Super-Admin — grants CMS access via the
    // Better-Auth SSO strategy. Only Admin+ may change a role (a moderator can't
    // elevate themselves); everyone on staff can read it.
    {
      name: 'role',
      type: 'select',
      defaultValue: 'Basic',
      index: true,
      options: MEMBER_ROLES.map((v) => ({ label: v, value: v })),
      access: { update: fieldAdminPlus, create: fieldAdminPlus },
      admin: {
        description: "App role — saving updates the user's role in the app and grants CMS access for Moderator/Admin/Super-Admin.",
      },
    },
    // ── Editable app-profile fields — saving writes back to public.users
    //    (onMemberProfileChange). Editable by moderators+ (CS edits).
    { name: 'firstName', type: 'text', admin: { description: 'App profile first name. Saving updates the app.' } },
    { name: 'lastName', type: 'text' },
    { name: 'bio', type: 'textarea' },
    { name: 'location', type: 'text' },
    { name: 'website', type: 'text' },
    { name: 'gender', type: 'text' },
    {
      name: 'avatarUrl',
      type: 'text',
      label: 'Avatar',
      admin: { components: { Cell: '@dvnt/cms/components/AvatarCell' }, description: 'Current app avatar URL (read-only — use “Replace avatar” below to change).', readOnly: true },
    },
    // Drag a new image here to replace the user's profile picture. On save the
    // image is published to public.media and public.users.avatar_id is repointed.
    {
      name: 'avatarUpload',
      type: 'upload',
      relationTo: 'media',
      label: 'Replace avatar',
      admin: { description: 'Drag/drop a new image to set as this user’s profile picture.' },
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
