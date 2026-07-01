// src/dashboard/screens/TeamScreen.tsx — grant console roles to app users.
// super_admin only. Pick an app user from a searchable dropdown (name + avatar),
// choose a role, grant it. They sign into the console with their existing app
// password (copied server-side). Below: the current console team, editable.
import { useEffect, useRef, useState } from 'react'
import { useMembers, useDebouncedSearch, useAdmins, useGrantRole, useSetAdminRole, useRevokeAdmin } from '../lib/hooks'
import type { Role } from '../lib/payload'
import { Avatar } from '../widgets'

const ROLE_OPTIONS: [Role, string][] = [
  ['moderator', 'Moderator'],
  ['admin', 'Admin'],
  ['super_admin', 'Super Admin'],
]
const roleLabel = (r: string) => ROLE_OPTIONS.find(([v]) => v === r)?.[1] ?? r

export function TeamScreen() {
  const [picked, setPicked] = useState<any | null>(null)
  const [role, setRole] = useState<Role>('moderator')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const grant = useGrantRole()
  const { data: admins } = useAdmins()

  const onGrant = async () => {
    if (!picked) return
    setMsg(null)
    try {
      const res = await grant.mutateAsync({ userId: String(picked.id), role })
      const how = res.loginMethod === 'password'
        ? 'They sign in to the console with their app password.'
        : 'They sign in to /admin with their existing app login (Google/Apple).'
      setMsg({ kind: 'ok', text: `${res.name} is now ${roleLabel(res.role)}. ${how}` })
      setPicked(null)
    } catch (e: any) {
      // ApiError carries the server's reason (e.g. social-only account).
      setMsg({ kind: 'err', text: e?.message || 'Could not grant the role.' })
    }
  }

  return (
    <section>
      <div className="dv-headrow">
        <h1 className="dv-h1">Console Team</h1>
      </div>

      {/* Grant card */}
      <div className="dv-card dv-grant">
        <div className="dv-grant__row">
          <div className="dv-grant__field">
            <label className="dv-label">App user</label>
            <UserPicker value={picked} onChange={setPicked} />
          </div>
          <div className="dv-grant__field dv-grant__field--role">
            <label className="dv-label">Role</label>
            <select className="dv-select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <button className="dv-btn dv-btn--primary dv-grant__btn" disabled={!picked || grant.isPending} onClick={onGrant}>
            {grant.isPending ? 'Granting…' : 'Grant role'}
          </button>
        </div>
        {msg && <p className={`dv-grant__msg dv-grant__msg--${msg.kind}`}>{msg.text}</p>}
      </div>

      {/* Current team */}
      <div className="dv-card">
        <table className="dv-table">
          <thead>
            <tr><th>Staff</th><th>Role</th><th className="r"></th></tr>
          </thead>
          <tbody>
            {(admins?.docs ?? []).map((a: any) => (
              <AdminRow key={a.id} admin={a} />
            ))}
          </tbody>
        </table>
        {admins && admins.docs.length === 0 && <div className="dv-empty">No console staff yet.</div>}
      </div>
    </section>
  )
}

function AdminRow({ admin }: { admin: any }) {
  const setRole = useSetAdminRole()
  const revoke = useRevokeAdmin()
  const name = admin.name || admin.email
  return (
    <tr>
      <td>
        <div className="dv-member">
          <Avatar uri={admin.avatarUrl} name={name} />
          <div>
            <div className="dv-name">{name}</div>
            <div className="dv-subtle">{admin.email}</div>
          </div>
        </div>
      </td>
      <td>
        <select
          className="dv-select dv-select--sm"
          value={admin.role}
          onChange={(e) => setRole.mutate({ id: String(admin.id), role: e.target.value as Role })}
          disabled={setRole.isPending}
        >
          {ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </td>
      <td className="r">
        <button
          className="dv-btn dv-btn--ghost dv-btn--danger"
          onClick={() => { if (confirm(`Revoke console access for ${name}?`)) revoke.mutate(String(admin.id)) }}
          disabled={revoke.isPending}
        >
          Revoke
        </button>
      </td>
    </tr>
  )
}

// Searchable app-user combobox: name + avatar.
function UserPicker({ value, onChange }: { value: any | null; onChange: (u: any | null) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const debounced = useDebouncedSearch(search, 250)
  const { data, isLoading } = useMembers({ search: debounced || undefined, limit: 8, sort: '-createdAt' })
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  if (value) {
    return (
      <div className="dv-picked">
        <Avatar uri={value.avatarUrl} name={value.username} />
        <div className="dv-picked__txt">
          <div className="dv-name">{value.username}</div>
          <div className="dv-subtle">{value.email}</div>
        </div>
        <button className="dv-picked__clear" aria-label="Clear" onClick={() => { onChange(null); setSearch('') }}>✕</button>
      </div>
    )
  }

  const rows = data?.docs ?? []
  return (
    <div className="dv-combo" ref={boxRef}>
      <input
        className="dv-input"
        placeholder="Search username or email…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && (search || rows.length > 0) && (
        <div className="dv-combo__menu">
          {isLoading && <div className="dv-combo__hint">Searching…</div>}
          {!isLoading && rows.length === 0 && <div className="dv-combo__hint">No matches.</div>}
          {rows.map((u: any) => (
            <button key={u.id} type="button" className="dv-combo__opt" onClick={() => { onChange(u); setOpen(false) }}>
              <Avatar uri={u.avatarUrl} name={u.username} />
              <span className="dv-combo__optTxt">
                <span className="dv-name">{u.username}</span>
                <span className="dv-subtle">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
