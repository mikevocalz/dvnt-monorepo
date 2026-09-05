// src/collections/Reports.ts — user reports against members.
// An open-report count of 3 auto-escalates the reported member to
// `under_review` (see onReportChange). Every report write recomputes the count.
import type { CollectionConfig } from 'payload'
import { canModerate } from '../access/roles'
import { onReportChange } from './hooks/moderation'

export const Reports: CollectionConfig = {
  slug: 'reports',
  dbName: 'reports',
  access: {
    read: canModerate,
    create: canModerate,
    update: canModerate, // resolve / dismiss
    delete: canModerate,
  },
  admin: {
    group: 'Moderation',
    description: 'User reports raw records — the Console Reports tab is the working queue.',
    useAsTitle: 'reason',
    defaultColumns: ['reportedMember', 'reason', 'status', 'createdAt'],
  },
  hooks: {
    afterChange: [onReportChange],
  },
  fields: [
    { name: 'reportedMember', type: 'relationship', relationTo: 'members', required: true, index: true },
    { name: 'reporter', type: 'relationship', relationTo: 'members' },
    { name: 'reason', type: 'text', required: true },
    { name: 'details', type: 'textarea' },
    {
      name: 'category',
      type: 'select',
      options: ['harassment', 'spam', 'safety', 'impersonation', 'hate', 'violence', 'comment', 'other'].map((v) => ({ label: v, value: v })),
    },
    // Set when the report targets a specific blog comment (category "comment").
    {
      name: 'reportedComment',
      type: 'relationship',
      relationTo: 'comments',
      index: true,
      admin: { description: 'Set when the report targets a specific comment.' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'open',
      index: true,
      options: ['open', 'resolved', 'dismissed'].map((v) => ({ label: v, value: v })),
    },
    { name: 'resolutionNote', type: 'textarea', admin: { position: 'sidebar' } },
    { name: 'resolvedBy', type: 'relationship', relationTo: 'admin-users', admin: { position: 'sidebar' } },
  ],
}
