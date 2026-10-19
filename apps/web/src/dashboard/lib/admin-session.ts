'use client'

import { QueryClient } from '@tanstack/react-query'
import { clearAllCachedData, signOut } from '@dvnt/app/lib/auth-client'
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store'
import { createAdminSignOut } from './admin-sign-out'
import { payload } from './payload'

export const adminQueryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

export const signOutAdmin = createAdminSignOut({
  clearLocalState: () => {
    void adminQueryClient.cancelQueries()
    adminQueryClient.clear()
    clearAllCachedData()
    useAuthStore.getState().setUser(null)
  },
  payloadLogout: () => payload.logout(),
  betterAuthSignOut: () => signOut(),
  readPayloadUser: () => payload.me(),
})
