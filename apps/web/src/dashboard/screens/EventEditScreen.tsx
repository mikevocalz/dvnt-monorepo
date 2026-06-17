// src/dashboard/screens/EventEditScreen.tsx — CS edit of a LIVE event (admin+).
// Reads/writes the real public.events row via the app endpoints (safe fields:
// title, status window, start/end, capacity, location).
import { useEffect, useState } from 'react'
import { useEvent, useUpdateEvent } from '../lib/hooks'
import { useRole } from '../lib/role'

export function EventEditScreen({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { canEditEvents } = useRole()
  const { data: ev, isLoading } = useEvent(eventId)
  const update = useUpdateEvent()

  const [title, setTitle] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [capacity, setCapacity] = useState('')
  const [location, setLocation] = useState('')

  useEffect(() => {
    if (!ev) return
    setTitle(ev.title ?? '')
    setStartsAt(ev.startsAt?.slice(0, 16) ?? '')
    setEndsAt(ev.endsAt?.slice(0, 16) ?? '')
    setCapacity(ev.capacity != null ? String(ev.capacity) : '')
    setLocation(ev.location ?? '')
  }, [ev])

  if (!canEditEvents) return <section><p className="dv-sub">You don't have permission to edit events.</p></section>
  if (isLoading || !ev) return <section><p className="dv-sub">Loading event…</p></section>

  const save = () => {
    update.mutate(
      {
        id: eventId,
        patch: {
          title,
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          capacity: capacity ? Number(capacity) : null,
          location,
        },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <section style={{ maxWidth: 720 }}>
      <div className="dv-headrow">
        <h1 className="dv-h1">Edit event</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="dv-btn dv-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="dv-btn dv-btn--primary" disabled={update.isPending} onClick={save}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {ev.flyerUrl && <img src={ev.flyerUrl} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 14, marginBottom: 4 }} />}

      <div className="dv-section">
        <p className="dv-section__title">Details</p>
        <div className="dv-field"><label>Title</label><input className="dv-input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="dv-field"><label>Starts</label><input className="dv-input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
        <div className="dv-field"><label>Ends</label><input className="dv-input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
        <div className="dv-field"><label>Capacity (max attendees)</label><input className="dv-input" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        <div className="dv-field"><label>Location</label><input className="dv-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue / address" /></div>
      </div>

      <p className="dv-subtle" style={{ marginTop: 12 }}>
        Host: {ev.host?.username ?? '—'} · {ev.attendees ?? 0} attending. Ticket tiers &amp; host reassignment are managed in the app.
      </p>
    </section>
  )
}
