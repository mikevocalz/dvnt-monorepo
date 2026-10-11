'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketEmbedsApi, type TicketEmbedBuilderData } from '@dvnt/app/lib/api/ticket-embeds';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import { useEventRole } from '@dvnt/app/lib/hooks/use-event-role';
import { renderOrganizerEmbedPreview } from '@dvnt/app/lib/ticket-embed/preview';

export function TicketEmbedOrganizerEntry({ eventId }: { eventId: string }) {
  const { role } = useEventRole(eventId);
  if (role !== 'owner' && role !== 'admin') return null;
  return (
    <nav className="mx-auto w-full max-w-2xl px-4 py-3" aria-label="Event embed tools">
      <a href={`/feed/events/${encodeURIComponent(eventId)}/embed`}
        className="block rounded-xl border border-white/10 bg-[#06070d] px-4 py-3 text-sm font-semibold text-[#3FDCFF]">
        Embed tickets <span className="ml-2 text-xs font-normal text-white/50">Configure and preview</span>
      </a>
    </nav>
  );
}

export function TicketEmbedSettingsScreen({ eventId }: { eventId: number }) {
  const userId = useAuthStore((s) => s.user?.id ?? 'anonymous');
  const authenticated = useAuthStore((s) => s.isAuthenticated);
  // Scope unsaved fields to both event and identity; never carry a draft to another organizer.
  return <Builder key={`${userId}:${eventId}`} eventId={eventId} userId={userId} authenticated={authenticated} />;
}

function Builder({ eventId, userId, authenticated }: { eventId: number; userId: string; authenticated: boolean }) {
  const useDraft = useMemo(() => create<{
    origin: string | null; width: '100%' | '390px';
    setOrigin: (origin: string | null) => void; setWidth: (width: '100%' | '390px') => void;
  }>((set) => ({ origin: null, width: '100%', setOrigin: (origin) => set({ origin }), setWidth: (width) => set({ width }) })), []);
  const draft = useDraft();
  const client = useQueryClient();
  const key = ['ticket-embed-settings', userId, eventId] as const;
  const query = useQuery({ queryKey: key, queryFn: () => ticketEmbedsApi.get(eventId), enabled: authenticated, retry: false });
  const logo = useQuery({
    queryKey: ['ticket-embed-brand-svg'], enabled: !!query.data,
    queryFn: async () => {
      const response = await fetch('/dvnt-wordmark.svg');
      const svg = await response.text();
      if (!response.ok || !svg.includes('<svg')) throw new Error('Could not load the DVNT logo.');
      return svg;
    }, staleTime: Infinity, retry: false,
  });
  const save = useMutation({
    mutationFn: () => ticketEmbedsApi.save(eventId, (draft.origin ?? query.data?.settings?.allowed_origin ?? '').trim(), query.data?.settings?.revision ?? 0),
    onSuccess: (data) => { client.setQueryData(key, data); draft.setOrigin(null); },
  });
  const revoke = useMutation({
    mutationFn: () => ticketEmbedsApi.revoke(eventId, query.data?.settings?.revision ?? 0),
    onSuccess: (data) => { client.setQueryData(key, data); draft.setOrigin(null); },
  });
  const preview = useMemo(() => query.data && logo.data
    ? renderOrganizerEmbedPreview(query.data.event, logo.data) : '', [query.data, logo.data]);
  const busy = save.isPending || revoke.isPending;
  const inputClass = 'mt-2 block w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#379ED8]';
  const buttonClass = 'rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold disabled:opacity-40';

  if (!authenticated) return <div className="p-8 text-white">Sign in to manage your event embed.</div>;
  if (query.isPending) return <div className="p-8 text-white" role="status">Loading embed settings…</div>;
  if (query.isError || !query.data) return (
    <div className="p-8 text-white" role="alert">
      <p>{query.error?.message || 'Could not load embed settings.'}</p>
      <button className={buttonClass} onClick={() => query.refetch()}>Retry</button>
    </div>
  );
  const data: TicketEmbedBuilderData = query.data;
  const mutationError = save.error || revoke.error;
  return (
    <main className="min-h-[100dvh] bg-[#06070d] px-4 py-6 text-white">
      <div className="mx-auto max-w-6xl">
        <a className="text-sm text-[#3FDCFF]" href={`/feed/events/${eventId}/organizer`}>← Event dashboard</a>
        <h1 className="mt-4 text-2xl font-bold">Embed tickets</h1>
        <p className="mt-1 text-sm text-white/60">{data.event.title}</p>
        <p id="embed-release-note" className="mt-5 rounded-xl border border-[#379ED8]/30 bg-[#379ED8]/5 p-4 text-sm text-white/75">
          Prepare your website integration here. Live embed sales and code publishing are not enabled yet.
          Saving this draft does not change ticket sales on DVNT.
        </p>
        <form className="mt-5 rounded-2xl border border-white/10 p-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <label className="block text-sm font-medium" htmlFor="embed-origin">Website origin</label>
          <input id="embed-origin" className={inputClass} type="url" required placeholder="https://events.example.com"
            value={draft.origin ?? data.settings?.allowed_origin ?? ''} disabled={busy}
            aria-describedby="origin-help" onChange={(event) => draft.setOrigin(event.target.value)} />
          <p id="origin-help" className="mt-2 text-xs leading-relaxed text-white/50">
            Enter one HTTPS origin, with no page path or wildcard. This is a draft allowlist setting,
            not domain-ownership verification. The live widget must enforce it before publishing is unlocked.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={`${buttonClass} bg-linear-to-r from-[#379ED8] to-[#874E9F]`}>
              {save.isPending ? 'Saving…' : 'Save embed settings'}
            </button>
            <button type="button" disabled={busy} className={buttonClass} onClick={() => { draft.setOrigin(null); save.reset(); revoke.reset(); query.refetch(); }}>Reload settings</button>
            <button type="button" disabled={busy || !data.settings || data.settings.status === 'revoked'} className={buttonClass}
              onClick={() => { if (window.confirm('Revoke this embed draft? Existing ticket purchases and paid orders will not change.')) revoke.mutate(); }}>Revoke draft</button>
            <button type="button" disabled className={buttonClass} aria-describedby="embed-release-note">Copy embed code</button>
          </div>
          <p className="mt-3 text-xs text-white/50" role="status">{data.settings ? `Saved ${data.settings.status} · revision ${data.settings.revision}` : 'No settings saved yet'}</p>
          {mutationError ? <p className="mt-3 text-sm text-red-300" role="alert">{mutationError.message}</p> : null}
        </form>
        <section className="mt-6" aria-labelledby="embed-preview-title">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 id="embed-preview-title" className="mr-auto font-semibold">Layout preview</h2>
            <button type="button" className={buttonClass} aria-pressed={draft.width === '100%'} onClick={() => draft.setWidth('100%')}>Desktop</button>
            <button type="button" className={buttonClass} aria-pressed={draft.width === '390px'} onClick={() => draft.setWidth('390px')}>Mobile</button>
          </div>
          {logo.isError ? <p role="alert" className="text-sm text-red-300">{logo.error.message}</p> : null}
          {!preview ? <p role="status">Loading preview…</p> : (
            <iframe title="Your event ticket layout — no purchases" srcDoc={preview} sandbox="" referrerPolicy="no-referrer"
              className="mx-auto block max-w-full border-0" style={{ width: draft.width, height: 1120 }} />
          )}
          <p className="mt-3 text-xs text-white/50">Your saved flyer and event information are used here. Ticket selection, payment and confirmation remain release-gated.</p>
        </section>
      </div>
    </main>
  );
}
