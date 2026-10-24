/** Mirror of the shared client policy; service-role responses must enforce it too. */
export function canShowEventAttendees(event: {
  event_type?: unknown;
  category?: unknown;
  lynk_room_id?: unknown;
  show_attendees?: unknown;
}): boolean {
  const type = typeof event.event_type === 'string' && event.event_type
    ? event.event_type : event.category;
  const protectedEvent = type === 'sex_party' || (
    typeof event.lynk_room_id === 'string' && event.lynk_room_id.trim().length > 0
  );
  return !protectedEvent || event.show_attendees === true;
}

/** Service-role bootstrap cannot rely on RLS or a caller-supplied viewer ID. */
export async function attendeeVisibleEventIds(
  db: any,
  events: Array<{ id: number; host_id?: string; event_type?: unknown; category?: unknown; lynk_room_id?: unknown; show_attendees?: unknown }>,
  verifiedAuthId: string | null,
): Promise<number[]> {
  const ordinary = events.filter(event => {
    const type = typeof event.event_type === 'string' && event.event_type ? event.event_type : event.category;
    return type !== 'sex_party' && !event.lynk_room_id;
  }).map(event => event.id);
  if (!verifiedAuthId) return ordinary;
  const protectedOptIns = events.filter(event => !ordinary.includes(event.id) && canShowEventAttendees(event));
  const ids = protectedOptIns.map(event => event.id);
  if (!ids.length) return ordinary;
  const visible = new Set([...ordinary, ...protectedOptIns.filter(event => event.host_id === verifiedAuthId).map(event => event.id)]);
  const results = await Promise.all([
    db.from('event_rsvps').select('event_id').in('event_id', ids).eq('user_id', verifiedAuthId).eq('status', 'going'),
    db.from('tickets').select('event_id').in('event_id', ids).eq('user_id', verifiedAuthId).in('status', ['active','scanned']),
    db.from('event_co_organizers').select('event_id').in('event_id', ids).eq('user_id', verifiedAuthId).eq('accepted', true),
  ]);
  for (const result of results) {
    if (!result.error) for (const row of result.data || []) visible.add(row.event_id);
  }
  return [...visible];
}
