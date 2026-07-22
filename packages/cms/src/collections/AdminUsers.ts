// src/collections/AdminUsers.ts — staff who log into the admin.
// Roles: super_admin | admin | moderator. The two known super-admins are pinned
// by email so an edit can't silently demote them.
import type { CollectionConfig } from 'payload'
import { isSuperAdmin, isStaff, forceSuperAdminByEmail } from '../access/roles'
import { betterAuthStrategy } from '../auth/betterAuthStrategy'

export const AdminUsers: CollectionConfig = {
  slug: 'admin-users',
  dbName: 'admin_users',
  // Local (email+password) login stays enabled; the custom strategy lets an app
  // user with a staff role into /admin via their existing Better Auth session
  // (no second login). A failing strategy returns null → local login unaffected.
  auth: {
    strategies: [betterAuthStrategy],
  },
  access: {
    read: isStaff,
    create: isSuperAdmin, // only super-admins mint new staff
    update: ({ req, id }) => req.user?.role === 'super_admin' || req.user?.id === id, // self or super
    delete: isSuperAdmin,
  },
  admin: {
    group: 'Access',
    description: 'Console/CMS staff accounts and roles.', useAsTitle: 'email', defaultColumns: ['email', 'name', 'role'] },
  hooks: {
    beforeChange: [
      ({ data }) => {
        // Pin the two canonical super-admins regardless of submitted role.
        const forced = forceSuperAdminByEmail(data?.email)
        if (forced) data.role = forced
        return data
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text' },
    // Mirrored from the app user (public.users) when promoted, so the console
    // Team list can show the same avatar. Rounded-square per DVNT.
    { name: 'avatarUrl', type: 'text', admin: { description: "App avatar (copied at promotion)" } },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'moderator',
      options: [
        { label: 'Super Admin', value: 'super_admin' },
        { label: 'Admin', value: 'admin' },
        { label: 'Moderator', value: 'moderator' },
      ],
      // Only super-admins can change roles; others see it read-only.
      access: { update: ({ req }) => req.user?.role === 'super_admin' },
    },
  ],
}
