// src/collections/BanList.ts — hashed ban-evasion keys.
// Direct edits are super-admin-only; the moderation hooks (onStatusChange)
// write here with `overrideAccess` when a ban is applied or lifted. Keys are
// one-way hashes (see hooks/banList.ts) so no raw PII is stored.
import type { CollectionConfig } from 'payload'
import { isSuperAdmin, isStaff } from '../access/roles'

export const BanList: CollectionConfig = {
  slug: 'ban-list',
  dbName: 'ban_list',
  access: {
    read: isStaff,
    create: isSuperAdmin, // direct creates are super-admin-only; hooks use overrideAccess
    update: isSuperAdmin,
    delete: isSuperAdmin,
  },
  admin: {
    group: 'Moderation',
    useAsTitle: 'keyHash',
    defaultColumns: ['keyType', 'active', 'member', 'createdAt'],
    description: 'Hashed ban-evasion keys. Managed by moderation hooks; lift a ban by reinstating the member.',
  },
  fields: [
    {
      name: 'keyType',
      type: 'select',
      required: true,
      options: ['email', 'name', 'ip', 'apple_sub', 'device'].map((v) => ({ label: v, value: v })),
    },
    { name: 'keyHash', type: 'text', required: true, index: true },
    { name: 'member', type: 'relationship', relationTo: 'members', index: true },
    { name: 'active', type: 'checkbox', defaultValue: true, index: true },
    { name: 'reason', type: 'text' },
  ],
}
