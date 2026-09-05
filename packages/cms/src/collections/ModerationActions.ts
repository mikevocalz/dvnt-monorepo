// src/collections/ModerationActions.ts — immutable audit log.
// Every member status transition writes one row here (via onStatusChange).
// Append-only: no updates or deletes are permitted, even for super-admins;
// rows are created exclusively by the server hook with `overrideAccess`.
import type { CollectionConfig } from 'payload'
import { canModerate } from '../access/roles'

export const ModerationActions: CollectionConfig = {
  slug: 'moderation-actions',
  dbName: 'moderation_actions',
  access: {
    read: canModerate,
    create: () => false, // server-only (hooks use overrideAccess)
    update: () => false, // immutable
    delete: () => false, // immutable
  },
  admin: {
    group: 'Moderation',
    description: 'Audit log of moderation decisions.',
    useAsTitle: 'action',
    defaultColumns: ['member', 'action', 'previousStatus', 'actor', 'createdAt'],
  },
  fields: [
    { name: 'member', type: 'relationship', relationTo: 'members', required: true, index: true },
    { name: 'action', type: 'text', required: true },
    { name: 'previousStatus', type: 'text' },
    { name: 'reason', type: 'textarea' },
    { name: 'actor', type: 'relationship', relationTo: 'admin-users' },
    { name: 'suspendedUntil', type: 'date' },
  ],
}
