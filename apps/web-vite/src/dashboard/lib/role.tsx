// src/dashboard/lib/role.tsx
import { createContext, useContext } from 'react'
import type { Role } from './payload'

const RoleCtx = createContext<Role | undefined>(undefined)

export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <RoleCtx.Provider value={role}>{children}</RoleCtx.Provider>
}

export function useRole() {
  const role = useContext(RoleCtx)
  return {
    role,
    isSuperAdmin: role === 'super_admin',
    isAdminPlus: role === 'super_admin' || role === 'admin',
    canModerate: role === 'super_admin' || role === 'admin' || role === 'moderator',
    canEditEvents: role === 'super_admin' || role === 'admin',
  }
}
