// src/dashboard/screens/EventsScreen.tsx — real app events with flyer thumbnails.
import { useState } from 'react'
import { useEvents, useDebouncedSearch } from '../lib/hooks'
import { useRole } from '../lib/role'
import { Pager } from '../widgets'

const STATUS_C: Record<string, string> = { published: '#86efac', cancelled: '#fca5a5', draft: 'var(--dim)', ended: 'var(--faint)' }

export function EventsScreen({ onEdit }: { onEdit?: (id: string) => void }) {
  const { canEditEvents } = useRole()
  const [search, setSearch] = useState('')
  const debounced = useDebouncedSearch(search, 300)
  const [page, setPage] = useState(1)
  const { data, isLoading } = useEvents({ search: debounced || undefined, page, limit: 50 })
  const rows = data?.docs ?? []

  return (
    <section>
      <div className="dv-headrow">
        <h1 className="dv-h1">Events</h1>
        <input className="dv-search" placeholder="Search title" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
      </div>
      <div className="dv-card">
        <table className="dv-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Status</th>
              <th>Starts</th>
              <th className="r">Attendees</th>
              <th className="r">Tickets</th>
              {canEditEvents && <th className="r"></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((e: any) => (
              <tr key={e.id}>
                <td>
                  <div className="dv-event">
                    {e.flyerUrl ? <img className="dv-flyer" src={e.flyerUrl} alt="" loading="lazy" /> : <span className="dv-flyer" />}
                    <div>
                      <div className="dv-name">{e.title}</div>
                      <div className="dv-subtle">by {e.host?.username ?? '—'}</div>
                    </div>
                  </div>
                </td>
                <td style={{ color: STATUS_C[e.status] ?? 'var(--text)', textTransform: 'capitalize' }}>{e.status}</td>
                <td>{e.startsAt ? new Date(e.startsAt).toLocaleDateString() : '—'}</td>
                <td className="r dv-num">{e.attendees ?? 0}</td>
                <td className="r dv-num">{e.ticketsSold ?? 0}</td>
                {canEditEvents && (
                  <td className="r"><button className="dv-btn" onClick={() => onEdit?.(e.id)}>Edit</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && rows.length === 0 && <div className="dv-empty">No events match.</div>}
      </div>
      <Pager page={page} totalPages={data?.totalPages ?? 1} total={data?.totalDocs ?? 0} onPage={setPage} />
    </section>
  )
}
