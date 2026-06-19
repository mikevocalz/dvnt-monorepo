// src/collections/Events.ts — CS-editable events.
// admin+ may edit core fields, ticket tiers, and reassign the host/organizer.
// Moderators get read-only (events aren't a moderation surface).
import type { CollectionConfig } from 'payload'
import { isAdminPlus, canModerate } from '../access/roles'
import { onEventChange, onEventCoverChange } from './hooks/event'

export const Events: CollectionConfig = {
  slug: 'events',
  dbName: 'events',
  access: {
    read: canModerate, // everyone on staff can view
    update: isAdminPlus, // CS edits restricted to admin+
    create: isAdminPlus,
    delete: isAdminPlus,
  },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'status', 'startsAt', 'host', 'tickets'] },
  // Saving writes the editable fields back to the live app event (public.events).
  hooks: { afterChange: [onEventChange, onEventCoverChange] },
  fields: [
    { name: 'title', type: 'text', index: true, required: true },
    // Stable key back to the live app event (public.events.id) — the sync upserts
    // on this so re-running never duplicates. Read-only; set by the sync.
    { name: 'appEventId', type: 'text', index: true, admin: { position: 'sidebar', readOnly: true, description: 'Live app event id' } },
    // List-only column: live ticket count that links to this event's tickets
    // (the filtered Tickets list, where each ticket's QR renders).
    {
      name: 'tickets',
      type: 'ui',
      label: 'Tickets',
      admin: { components: { Cell: '@dvnt/cms/components/TicketsLinkCell' } },
    },
    {
      name: 'status',
      type: 'select',
      options: ['draft', 'published', 'cancelled', 'ended'].map((v) => ({ label: v, value: v })),
    },
    { name: 'description', type: 'textarea', admin: { description: 'Event description. Saving updates the app.' } },
    // Drag a new image to replace the event flyer/cover (-> public.media,
    // repoints public.events.cover_image_id).
    {
      name: 'coverUpload',
      type: 'upload',
      relationTo: 'media',
      label: 'Replace flyer / cover',
      admin: { description: 'Drag/drop a new flyer image to set as this event’s cover.' },
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
