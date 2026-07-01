/** @jsxImportSource react */
'use client'
// List-cell for the Events `tickets` UI column. Shows the live count of tickets
// issued for the row's event and links to that event's filtered ticket list in
// the admin (where each ticket's QR renders via TicketQRField). The count is
// fetched client-side from the REST API so it needs no stored column.
import React from 'react'

export default function TicketsLinkCell(props: any) {
  const eventId = props?.rowData?.id
  const [count, setCount] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!eventId) return
    let alive = true
    fetch(`/payload-api/tickets?where[event][equals]=${eventId}&limit=0&depth=0`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => alive && setCount(typeof d?.totalDocs === 'number' ? d.totalDocs : 0))
      .catch(() => alive && setCount(0))
    return () => {
      alive = false
    }
  }, [eventId])

  if (!eventId) return <span style={{ color: 'rgba(255,255,255,0.4)' }}>—</span>

  const href = `/admin/collections/tickets?where[event][equals]=${eventId}`
  return (
    <a
      href={href}
      style={{ color: '#c4b5fd', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}
      title="View this event's tickets"
    >
      {count === null ? '…' : count} {count === 1 ? 'ticket' : 'tickets'} ↗
    </a>
  )
}
