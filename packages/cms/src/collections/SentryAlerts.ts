import type { CollectionConfig } from 'payload'

/**
 * sentry-alerts — the durable in-admin alert log (PROMPT NN · A9).
 * Rows are created ONLY by the sentry-webhook endpoint (issue created /
 * regressed / resolved from the dvnt-admin internal integration); admins
 * read + mark-read here. Email stays the push channel; this is the record.
 * Only issue METADATA is stored — never event payloads or user context.
 */
export const SentryAlerts: CollectionConfig = {
  slug: 'sentry-alerts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'action', 'project', 'read', 'createdAt'],
    description: 'Sentry issue alerts (created/regressed/resolved). Read-only log.',
    group: 'Observability',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user), // mark read/unread
    create: () => false, // webhook endpoint writes with overrideAccess
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'action', type: 'select', options: ['created', 'regressed', 'resolved', 'unresolved', 'other'], required: true },
    { name: 'title', type: 'text', required: true },
    { name: 'shortId', type: 'text' },
    { name: 'issueId', type: 'text', index: true },
    { name: 'project', type: 'text' },
    { name: 'level', type: 'text' },
    { name: 'permalink', type: 'text' },
    { name: 'read', type: 'checkbox', defaultValue: false, index: true },
  ],
  timestamps: true,
}
