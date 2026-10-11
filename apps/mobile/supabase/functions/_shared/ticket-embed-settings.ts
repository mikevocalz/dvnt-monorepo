/** Organizer-only draft settings. Deliberately has no Stripe or checkout dependency. */
export const EMBED_SETTINGS_SELECT =
  'id,event_id,allowed_origin,revision,status,updated_at';

export function normalizeEmbedOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 255 || /[\s\\]/.test(value)) {
    throw new Error('Enter an HTTPS website origin, for example https://events.example.com.');
  }
  const url = new URL(value);
  // Exact origins only. No wildcard, redirect path, credentials or insecure scheme.
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname) ||
      /\.(?:localhost|local|internal|test)$/i.test(url.hostname)) {
    throw new Error('Use an exact public HTTPS origin with no path, query, port or wildcard.');
  }
  return url.origin;
}

export type EmbedManagerDependencies = {
  db: any;
  authenticate: (req: Request) => Promise<string | null>;
  enabled: boolean;
  headers: (req: Request) => Record<string, string>;
};

/** Extracted handler keeps authorization and stale-save tests executable without Deno. */
export function createEmbedSettingsHandler(deps: EmbedManagerDependencies) {
  return async (req: Request): Promise<Response> => {
    const headers = { ...deps.headers(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!deps.enabled) return json({ error: 'Embed builder is not enabled.' }, 404);
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    try {
      const userId = await deps.authenticate(req);
      if (!userId) return json({ error: 'Sign in to manage event embeds.' }, 401);
      const text = await req.text();
      if (text.length > 4096) return json({ error: 'Request too large.' }, 413);
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        body = parsed as Record<string, unknown>;
      } catch { return json({ error: 'Invalid request.' }, 400); }
      const eventId = body.event_id;
      if (typeof eventId !== 'number' || !Number.isSafeInteger(eventId) || eventId <= 0) {
        return json({ error: 'A valid event id is required.' }, 400);
      }
      if (!['get', 'save', 'revoke', 'generate'].includes(String(body.action))) {
        return json({ error: 'Unknown action.' }, 400);
      }
      const { db } = deps;
      const eventResult = await db.from('events')
        .select('id,host_id,title,start_date,event_tz,location_name,location,flyer_image_url,cover_image_url,image')
        .eq('id', eventId).maybeSingle();
      if (eventResult.error) throw new Error('event_read');
      const event = eventResult.data;
      if (!event) return json({ error: 'Event not found.' }, 404);
      let role: 'owner' | 'admin' = 'owner';
      if (event.host_id !== userId) {
        const staff = await db.from('event_co_organizers').select('id')
          .eq('event_id', eventId).eq('user_id', userId).eq('accepted', true)
          .eq('role', 'admin').maybeSingle();
        if (staff.error) throw new Error('staff_read');
        if (!staff.data) return json({ error: 'Only the event owner or an accepted admin can manage embeds.' }, 403);
        role = 'admin';
      }
      // This gate is server-side, not merely a disabled UI button. No client
      // flag may opt into unfinished payment, inventory or ticket delivery code.
      if (body.action === 'generate') {
        return json({ error: 'Live embed code is unavailable until checkout and fulfillment are verified.', code: 'embed_checkout_not_ready' }, 409);
      }
      const existingResult = await db.from('event_ticket_embed_settings')
        .select(EMBED_SETTINGS_SELECT).eq('event_id', eventId).maybeSingle();
      if (existingResult.error) throw new Error('settings_read');
      let settings = existingResult.data;
      if (body.action !== 'get') {
        const revision = body.expected_revision;
        if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
          return json({ error: 'A settings revision is required.' }, 400);
        }
        if ((settings?.revision ?? 0) !== revision) return json({ error: 'Settings changed. Reload before saving.' }, 409);
        if (body.action === 'revoke' && !settings) return json({ error: 'No embed settings to revoke.' }, 409);
        let origin = settings?.allowed_origin;
        if (body.action === 'save') {
          try { origin = normalizeEmbedOrigin(body.allowed_origin); }
          catch (e) { return json({ error: e instanceof Error ? e.message : 'Invalid website origin.' }, 400); }
        }
        const patch = {
          allowed_origin: origin,
          status: body.action === 'revoke' ? 'revoked' : 'draft',
          revision: revision + 1,
          updated_at: new Date().toISOString(),
          updated_by: userId,
        };
        // Compare-and-swap prevents a stale browser tab from restoring revoked settings.
        const write = settings
          ? await db.from('event_ticket_embed_settings').update(patch)
            .eq('event_id', eventId).eq('revision', revision).select(EMBED_SETTINGS_SELECT).maybeSingle()
          : await db.from('event_ticket_embed_settings').insert({ ...patch, event_id: eventId })
            .select(EMBED_SETTINGS_SELECT).maybeSingle();
        if (write.error?.code === '23505' || (!write.error && !write.data)) {
          return json({ error: 'Settings changed. Reload before saving.' }, 409);
        }
        if (write.error) throw new Error('settings_write');
        settings = write.data;
      }
      // A role-checked preview only. Do not return host IDs, unlock codes,
      // attendees, buyer details or payment credentials.
      return json({
        ok: true, role, settings, canGenerate: false,
        event: {
          id: event.id, title: event.title ?? 'Event', startDate: event.start_date, timeZone: event.event_tz,
          location: event.location_name || event.location || '',
          flyerUrl: event.flyer_image_url || event.cover_image_url || event.image || null,
        },
      });
    } catch {
      return json({ error: 'Could not manage embed settings. No purchasing settings were changed.' }, 500);
    }
  };
}
