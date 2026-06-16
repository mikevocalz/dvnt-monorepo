// src/dashboard/screens/ReportsScreen.tsx — block / harassment / comment reports.
import { useState } from 'react'
import { useReports, useResolveReport, useRemoveComment, useDebouncedSearch } from '../lib/hooks'
import { Pager } from '../widgets'

const STATES = ['open', 'resolved', 'dismissed', 'all']

export function ReportsScreen() {
  const [search, setSearch] = useState('')
  const debounced = useDebouncedSearch(search, 300)
  const [status, setStatus] = useState('open')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useReports({ search: debounced || undefined, status: status === 'all' ? undefined : status, page, limit: 50, sort: '-createdAt' })
  const resolve = useResolveReport()
  const removeComment = useRemoveComment()
  const rows = data?.docs ?? []

  return (
    <section>
      <div className="dv-headrow">
        <h1 className="dv-h1">Reports</h1>
        <input className="dv-search" placeholder="Search reason" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      <div className="dv-filters">
        {STATES.map((s) => (
          <button key={s} className={`dv-filter${status === s ? ' is-active' : ''}`} onClick={() => { setStatus(s); setPage(1) }}>{s}</button>
        ))}
      </div>
      <div className="dv-card">
        <table className="dv-table">
          <thead>
            <tr><th>Category</th><th>Reported</th><th>By</th><th>Reason</th><th className="r"></th></tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td><span className="dv-badge" style={{ background: 'rgba(255,91,252,0.12)', color: 'var(--brand)' }}>{r.category}</span></td>
                <td className="dv-name">{r.reportedMember?.username ?? r.reportedMember ?? '—'}</td>
                <td className="dv-subtle">{r.reporter?.username ?? r.reporter ?? '—'}</td>
                <td className="dv-subtle">{r.reason || '—'}</td>
                <td className="r">
                  {r.status === 'open' ? (
                    <div className="dv-actions">
                      {r.reportedComment && (
                        <button className="dv-btn dv-btn--primary" onClick={() => {
                          const cid = typeof r.reportedComment === 'object' ? r.reportedComment.id : r.reportedComment
                          removeComment.mutate(cid)
                          resolve.mutate({ id: r.id, status: 'resolved' })
                        }}>Remove comment</button>
                      )}
                      <button className="dv-btn" onClick={() => resolve.mutate({ id: r.id, status: 'resolved' })}>Resolve</button>
                      <button className="dv-btn dv-btn--ghost" onClick={() => resolve.mutate({ id: r.id, status: 'dismissed' })}>Dismiss</button>
                    </div>
                  ) : (
                    <span className="dv-subtle" style={{ textTransform: 'capitalize' }}>{r.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && rows.length === 0 && <div className="dv-empty">No reports in this state.</div>}
      </div>
      <Pager page={page} totalPages={data?.totalPages ?? 1} total={data?.totalDocs ?? 0} onPage={setPage} />
    </section>
  )
}
