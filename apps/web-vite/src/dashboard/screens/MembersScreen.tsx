// src/dashboard/screens/MembersScreen.tsx — real app members with avatars.
import { useState } from 'react'
import { useMembers, useDebouncedSearch } from '../lib/hooks'
import { Avatar, StatusBadge, ModerationMenu, Pager } from '../widgets'

export function MembersScreen() {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedSearch(search, 300)
  const [page, setPage] = useState(1)
  const { data, isLoading } = useMembers({ search: debounced || undefined, page, limit: 50, sort: '-createdAt' })
  const rows = data?.docs ?? []

  return (
    <section>
      <div className="dv-headrow">
        <h1 className="dv-h1">Members</h1>
        <input className="dv-search" placeholder="Search username / email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      <div className="dv-card">
        <table className="dv-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Status</th>
              <th className="r">Reports</th>
              <th className="r">Followers</th>
              <th className="r">Joined</th>
              <th className="r"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m: any) => (
              <tr key={m.id}>
                <td>
                  <div className="dv-member">
                    <Avatar uri={m.avatarUrl} name={m.username} />
                    <div>
                      <div className="dv-name">
                        {m.username}
                        {m.verified && <span className="dv-verified" title="Verified">✓</span>}
                      </div>
                      <div className="dv-subtle">{m.email}</div>
                    </div>
                  </div>
                </td>
                <td><StatusBadge status={m.status} /></td>
                <td className="r dv-num" style={Number(m.openReportsAgainst) > 0 ? { color: 'var(--danger)' } : undefined}>{m.openReportsAgainst ?? 0}</td>
                <td className="r dv-num">{(m.followers ?? 0).toLocaleString()}</td>
                <td className="r dv-num">{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : '—'}</td>
                <td className="r"><div className="dv-actions"><ModerationMenu member={m} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && rows.length === 0 && <div className="dv-empty">No members match.</div>}
      </div>
      <Pager page={page} totalPages={data?.totalPages ?? 1} total={data?.totalDocs ?? 0} onPage={setPage} />
    </section>
  )
}
