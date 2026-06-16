// src/dashboard/lib/hooks.ts
// Data hooks over the Payload REST client. Search inputs are instant in the
// field but debounced into queries by Pacer, so the query key only churns
// after the user pauses (page resets on change at the screen level).
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { payload, type Paginated, type Role } from './payload'

export function useDebouncedSearch(value: string, wait = 300): string {
  const [debounced] = useDebouncedValue(value, { wait })
  return debounced
}

type ListArgs = { search?: string; page?: number; limit?: number; sort?: string }

// Members/Events read REAL app data (public.users / public.events) via the
// read-only app endpoints — not Payload's own collections.
export function useMembers(args: ListArgs) {
  return useQuery({
    queryKey: ['members', args],
    queryFn: () => payload.app.members(args),
  })
}

export function useEvents(args: ListArgs) {
  return useQuery({
    queryKey: ['events', args],
    queryFn: () => payload.app.events(args),
  })
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: () => payload.app.event(id),
    enabled: !!id,
  })
}

export function useReports(args: ListArgs & { status?: string }) {
  return useQuery({
    queryKey: ['reports', args],
    queryFn: () =>
      payload.find('reports', {
        ...args,
        where: args.status ? { status: { equals: args.status } } : undefined,
      }),
  })
}

export function useUpdateEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      payload.app.updateEvent(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events'] })
      qc.invalidateQueries({ queryKey: ['event'] })
    },
  })
}

// One PATCH; the server's onStatusChange hook fans out ban_list + audit + revoke.
export function useSetStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
      reason,
      suspendedUntil,
    }: {
      id: string
      status: string
      reason?: string
      suspendedUntil?: string
    }) =>
      payload.update('members', id, {
        status,
        lastModerationReason: reason,
        suspendedUntil,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  })
}

export function useResolveReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note?: string }) =>
      payload.update('reports', id, { status, resolutionNote: note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  })
}

// Remove a reported comment (kept in DB for audit; hidden from the public).
export function useRemoveComment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => payload.update('comments', commentId, { status: 'removed' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      qc.invalidateQueries({ queryKey: ['comments'] })
    },
  })
}

// ── Console team (admin_users) ──────────────────────────────────────────────
// Current staff who can sign into the console, newest first.
export function useAdmins() {
  return useQuery({
    queryKey: ['admins'],
    queryFn: () => payload.find<any>('admin-users', { limit: 100, sort: 'email' }),
  })
}

// Grant an app user a console role (reuses their app password server-side).
export function useGrantRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) => payload.app.promote(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  })
}

// Change an existing staff member's role.
export function useSetAdminRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => payload.update('admin-users', id, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  })
}

// Revoke console access entirely.
export function useRevokeAdmin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => payload.remove('admin-users', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admins'] }),
  })
}

// Overview counters — from the live app DB.
export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => payload.app.stats(),
  })
}

export type { Paginated }
