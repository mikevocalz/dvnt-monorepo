// src/access/roles.ts
// Four-tier RBAC for the DVNT admin.
//   super_admin — full control incl. managing admin users + lifting ban-list keys
//   admin       — CS + moderation; edit events; ban/reinstate
//   moderator   — review reports + change user status incl. ban AND reinstate
// (Moderators were granted reinstate per product decision.)
import type { Access, FieldAccess } from 'payload'

export type Role = 'super_admin' | 'admin' | 'moderator'

const SUPER_ADMIN_EMAILS = ['mike@deviant.live', 'devianteventsdc@gmail.com', 'mikefacesny@gmail.com']

export const roleOf = (req: any): Role | undefined => req?.user?.role
export const isAtLeast = (req: any, ...roles: Role[]) => !!req?.user && roles.includes(req.user.role)

// Collection-level access fns
export const isStaff: Access = ({ req }) => Boolean(req.user)
export const isSuperAdmin: Access = ({ req }) => roleOf(req) === 'super_admin'
export const isAdminPlus: Access = ({ req }) => isAtLeast(req, 'super_admin', 'admin')
export const canModerate: Access = ({ req }) => isAtLeast(req, 'super_admin', 'admin', 'moderator')

// Field-level variants
export const fieldSuperAdmin: FieldAccess = ({ req }) => roleOf(req) === 'super_admin'
export const fieldAdminPlus: FieldAccess = ({ req }) => isAtLeast(req, 'super_admin', 'admin')

export const SUPER_ADMIN_EMAILS_LIST = SUPER_ADMIN_EMAILS
export const forceSuperAdminByEmail = (email?: string): Role | undefined =>
  email && SUPER_ADMIN_EMAILS.includes(email.toLowerCase()) ? 'super_admin' : undefined
