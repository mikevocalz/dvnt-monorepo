// src/collections/Events.ts — CS-editable events.
// admin+ may edit core fields, ticket tiers, and reassign the host/organizer.
// Moderators get read-only (events aren't a moderation surface).
import type { CollectionConfig } from 'payload'
import { isAdminPlus, canModerate } from '../access/roles'

export const Events: CollectionConfig = {
  slug: 'events',
  dbName: 'events',
  access: {
    read: canModerate, // everyone on staff can view
    update: isAdminPlus, // CS edits restricted to admin+
    create: isAdminPlus,
    delete: isAdminPlus,
  },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'status', 'startsAt', 'host'] },
  fields: [
    { name: 'title', type: 'text', index: true, required: true },
    // Stable key back to the live app event (public.events.id) — the sync upserts
    // on this so re-running never duplicates. Read-only; set by the sync.
    { name: 'appEventId', type: 'text', index: true, admin: { position: 'sidebar', readOnly: true, description: 'Live app event id' } },
    {
      // Mirrors the live public.events.status state machine (NOT visibility).
      // Edits write the same column the app reads; illegal transitions are
      // guarded by the DB triggers, so CMS edits stay within the machine.
      name: 'status',
      type: 'select',
      options: ['draft', 'active', 'cancelled', 'postponed', 'suspended'].map((v) => ({ label: v, value: v })),
    },
    {
      // Visibility is separate from status (was conflated before). public/
      // private/spicy/link_only per the app's visibility enum.
      name: 'visibility',
      type: 'select',
      options: ['public', 'private', 'spicy', 'link_only'].map((v) => ({ label: v, value: v })),
    },
    { name: 'startsAt', type: 'date' },
    { name: 'endsAt', type: 'date' },
    { name: 'capacity', type: 'number' },
    { name: 'location', type: 'text' },
    // CS can reassign organizer if an account is compromised/transferred.
    {
      name: 'host',
      type: 'relationship',
      relationTo: 'members',
      admin: { description: 'Organizer of record. Reassign with care — audited.' },
    },
    {
      name: 'ticketTiers',
      type: 'array',
      label: 'Ticket tiers',
      admin: { description: 'Edit tier name, price (cents), and inventory.' },
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'priceCents', type: 'number', required: true, min: 0 },
        { name: 'quantity', type: 'number', required: true, min: 0 },
        { name: 'soldCount', type: 'number', defaultValue: 0, admin: { readOnly: true } },
        { name: 'active', type: 'checkbox', defaultValue: true },
      ],
    },
    { name: 'attendees', type: 'number', defaultValue: 0, admin: { readOnly: true } },
    { name: 'ticketsSold', type: 'number', defaultValue: 0, admin: { readOnly: true } },
  ],
}
