// src/collections/Tickets.ts — issued event tickets mirrored from the live app
// (public.tickets), so CS can see who holds tickets for an event and fix an
// attendee name or quantity. Synced on `appTicketId`; the editable fields
// (attendeeName, quantity) are preserved across re-syncs so CMS edits stick.
import type { CollectionConfig } from 'payload'
import { canModerate, isAdminPlus } from '../access/roles'

export const TICKET_STATUSES = ['valid', 'checked_in', 'cancelled', 'refunded', 'transferred', 'pending'] as const

export const Tickets: CollectionConfig = {
  slug: 'tickets',
  dbName: 'tickets',
  access: {
    read: canModerate,
    update: isAdminPlus, // CS edits (name / quantity) restricted to admin+
    create: isAdminPlus,
    delete: isAdminPlus,
  },
  admin: {
    group: 'App mirror — auto-synced',
    description: 'Live app tickets, synced every 10 minutes.',
    useAsTitle: 'attendeeName',
    defaultColumns: ['attendeeName', 'event', 'tier', 'quantity', 'status'],
    listSearchableFields: ['attendeeName', 'guestEmail'],
  },
  fields: [
    { name: 'event', type: 'relationship', relationTo: 'events', admin: { description: 'Event this ticket admits to.' } },
    { name: 'holder', type: 'relationship', relationTo: 'members', admin: { description: 'App user who holds the ticket (empty for guest tickets).' } },
    { name: 'tier', type: 'text', admin: { description: 'Ticket type / tier name.' } },
    // The two CS-editable fields the dashboard cares about.
    { name: 'attendeeName', type: 'text', admin: { description: 'Name printed on the ticket. Editable.' } },
    { name: 'quantity', type: 'number', defaultValue: 1, min: 1, admin: { description: 'Tickets in this holding. Editable.' } },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'valid',
      options: TICKET_STATUSES.map((v) => ({ label: v.replace('_', ' '), value: v })),
    },
    { name: 'guestEmail', type: 'email', admin: { position: 'sidebar' } },
    { name: 'purchasedAt', type: 'date', admin: { position: 'sidebar', readOnly: true } },
    { name: 'qrToken', type: 'text', admin: { position: 'sidebar', readOnly: true, description: 'Scan token (read-only).' } },
    // Renders the scannable QR from qrToken (client-side; the token never leaves
    // the browser). Read-only — synced from the live app.
    {
      name: 'qr',
      type: 'ui',
      label: 'QR code',
      admin: { components: { Field: '@dvnt/cms/components/TicketQRField' } },
    },
    // Stable key back to public.tickets.id — sync upserts on this.
    { name: 'appTicketId', type: 'text', index: true, admin: { position: 'sidebar', readOnly: true } },
  ],
}
