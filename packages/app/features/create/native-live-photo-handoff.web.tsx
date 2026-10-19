'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../lib/stores/auth-store';
import { useCreatePostStore } from '../../lib/stores/create-post-store';
import { livePhotoHandoffApi } from '../../lib/api/live-photo-handoff';
import { addHandoffAssets, captureHandoffDraft, draftFingerprint, restoreHandoffDraft, type HandoffDraft, type SavedHandoff } from './live-photo-handoff-draft';
import { deleteHandoffDraft, loadHandoffDraft, saveHandoffDraft } from './live-photo-handoff-storage.web';

const button = 'rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-50';
const currentDraft = () => useCreatePostStore.getState();
const currentOwner = () => {
  const user = useAuthStore.getState().user;
  return user?.authId || user?.id ? String(user.authId || user.id) : null;
};

/** App-assisted import, not a claim that Safari can extract Apple's paired resource. */
export function NativeLivePhotoHandoff({ disabled, onPendingChange }: { disabled: boolean; onPendingChange: (pending: boolean) => void }) {
  const user = useAuthStore(state => state.user);
  const ownerId = user?.authId || user?.id ? String(user.authId || user.id) : null;
  const [saved, setSaved] = useState<SavedHandoff | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const epoch = useRef(0);
  const operation = useRef<number | null>(null);
  const baseline = useRef<string | null>(null);

  useEffect(() => {
    const version = ++epoch.current;
    operation.current = null; setLoading(true);
    setSaved(null); setError(''); setNotice(''); setBusy(false); setReplaceConfirmed(false); baseline.current = null;
    if (ownerId) void loadHandoffDraft(ownerId).then(record => {
      if (epoch.current === version && currentOwner() === ownerId) setSaved(record);
    }).catch(() => {}).finally(() => { if (epoch.current === version) setLoading(false); });
    else setLoading(false);
    return () => { epoch.current += 1; };
  }, [ownerId]);
  useEffect(() => {
    onPendingChange(loading || busy || Boolean(saved && !saved.applied));
    return () => onPendingChange(false);
  }, [loading, busy, saved?.draftId, saved?.applied, onPendingChange]);

  useEffect(() => {
    if (!saved?.handoff || saved.applied || !ownerId) return;
    const version = epoch.current;
    let stopped = false;
    let inFlight = false;
    const check = async () => {
      if (stopped || inFlight || document.visibilityState === 'hidden' || operation.current !== null) return;
      if (Date.parse(saved.handoff!.expiresAt) <= Date.now()) {
        setSaved(previous => previous?.draftId === saved.draftId ? { ...previous, handoff: { ...previous.handoff!, state: 'expired' } } : previous);
        return;
      }
      inFlight = true;
      try {
        const next = await livePhotoHandoffApi.status(saved.handoff!.id, saved.draftId);
        if (stopped || version !== epoch.current || currentOwner() !== ownerId) return;
        setSaved(previous => previous?.draftId === saved.draftId ? { ...previous, handoff: next } : previous);
      } catch (cause) {
        if (!stopped && version === epoch.current) setError(cause instanceof Error ? cause.message : 'Unable to check the app upload. Your saved draft is safe.');
      } finally { inFlight = false; }
    };
    void check();
    const interval = window.setInterval(check, 5000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { stopped = true; window.clearInterval(interval); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [saved?.handoff?.id, saved?.applied, ownerId]);

  async function run(action: (assertCurrent: () => void) => Promise<void>) {
    if (operation.current !== null || disabled || loading || !ownerId) return;
    const version = epoch.current;
    operation.current = version; setBusy(true); setError(''); onPendingChange(true);
    const assertCurrent = () => { if (version !== epoch.current || currentOwner() !== ownerId) throw new Error('Account or screen changed. Return to the account that started the draft.'); };
    try { await action(assertCurrent); }
    catch (cause) { if (version === epoch.current) setError(cause instanceof Error ? cause.message : 'Could not finish. Your draft is unchanged.'); }
    finally { if (operation.current === version) operation.current = null; if (version === epoch.current) setBusy(false); }
  }

  const start = () => run(async assertCurrent => {
    const draft = currentDraft();
    if (draft.selectedMedia.length >= 10) throw new Error('Remove one item before adding Live Photos.');
    const fingerprint = draftFingerprint(draft);
    const record = await captureHandoffDraft(ownerId!, draft);
    assertCurrent();
    await saveHandoffDraft(record); // Must commit blobs before leaving the browser.
    assertCurrent();
    setSaved(record); baseline.current = fingerprint;
    if (draftFingerprint(currentDraft()) !== fingerprint) throw new Error('Your draft changed while saving. Please retry.');
    const handoff = await livePhotoHandoffApi.create(record.draftId, 10 - draft.selectedMedia.length);
    assertCurrent();
    const prepared = { ...record, handoff };
    await saveHandoffDraft(prepared);
    assertCurrent();
    if (draftFingerprint(currentDraft()) !== fingerprint) throw new Error('Your draft changed while preparing. Please retry.');
    baseline.current = fingerprint; setSaved(prepared); setReplaceConfirmed(false);
  });

  const retryPrepare = () => run(async assertCurrent => {
    if (!saved || saved.handoff) return;
    const handoff = await livePhotoHandoffApi.create(saved.draftId, 10 - saved.draft.selectedMedia.length);
    assertCurrent();
    const prepared = { ...saved, handoff };
    await saveHandoffDraft(prepared); assertCurrent();
    setSaved(prepared);
  });

  const resume = () => run(async assertCurrent => {
    if (!saved) return;
    // Never silently overwrite a newer browser draft, including a new tab.
    const unchanged = baseline.current === draftFingerprint(currentDraft());
    if (!unchanged && !replaceConfirmed) { setNotice('This restores the saved draft and replaces the draft currently on this screen. Confirm below, or keep editing your current draft.'); return; }
    const beforeRestore = draftFingerprint(currentDraft());
    let record = saved;
    if (!record.applied && record.handoff && ['ready', 'consumed'].includes(record.handoff.state)) {
      const consumed = await livePhotoHandoffApi.consume(record.handoff.id, record.draftId, record.requestId);
      assertCurrent();
      record = { ...record, handoff: consumed, applied: true, draft: addHandoffAssets(record.draft, consumed.assets ?? [], ownerId!, record.handoff.id) };
      // Persist result BEFORE changing the UI. Same requestId retries a lost response safely.
      await saveHandoffDraft(record);
      assertCurrent();
    }
    if (draftFingerprint(currentDraft()) !== beforeRestore) {
      setSaved(record); setReplaceConfirmed(false);
      setNotice("This restores the saved draft and replaces the draft currently on this screen. Your draft changed while receiving media; confirm below to restore it.");
      return;
    }
    const restored = restoreHandoffDraft(record, ownerId!);
    assertCurrent();
    useCreatePostStore.setState(restored as Partial<ReturnType<typeof currentDraft>>);
    baseline.current = draftFingerprint(currentDraft());
    setSaved(record); setReplaceConfirmed(false);
    setNotice(record.applied ? 'Live Photos are in your draft. Review it, then choose Share when ready.' : 'Your saved draft has been restored. Nothing was posted.');
  });

  const discard = () => run(async assertCurrent => {
    if (!saved) return;
    if (saved.handoff && !saved.applied && Date.parse(saved.handoff.expiresAt) > Date.now() && saved.handoff.state !== 'cancelled') {
      await livePhotoHandoffApi.cancel(saved.handoff.id, saved.draftId);
      assertCurrent();
    }
    await deleteHandoffDraft(ownerId!, saved.draftId); assertCurrent();
    setSaved(null); setNotice('App pickup cancelled. The draft on this screen is unchanged.');
  });

  const state = saved?.handoff?.state;
  const pending = state === 'pending';
  const ready = state === 'ready' || state === 'consumed' || saved?.applied;
  const link = saved?.handoff ? `dvnt://live-photo-handoff?handoff=${encodeURIComponent(saved.handoff.id)}&draft=${encodeURIComponent(saved.draftId)}` : '';
  return <section className="mt-3 rounded-xl border border-white/10 p-3" aria-label="Live Photo app pickup">
    <p className="text-sm">Keep Live Photo motion using the installed DVNT app.</p>
    <p className="mt-1 text-xs text-white/60">Your browser draft is saved first. Select Live Photos in DVNT, then switch back to this browser tab. Nothing is posted automatically.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {!saved && <button type="button" className={button} disabled={disabled || busy || loading || !ownerId} onClick={start}>{busy ? 'Saving draft…' : 'Add Live Photos with DVNT'}</button>}
      {saved && !saved.handoff && <button type="button" className={button} disabled={disabled || busy} onClick={retryPrepare}>Retry app pickup</button>}
      {pending && !busy && !disabled && <a className={button} href={link}>Open DVNT picker</a>}
      {saved && <button type="button" className={button} disabled={disabled || busy} onClick={resume}>{ready ? 'Restore draft with Live Photos' : 'Restore saved draft'}</button>}
      {saved && <button type="button" className={button} disabled={disabled || busy} onClick={discard}>{saved.applied ? 'Remove saved backup' : 'Cancel app pickup'}</button>}
    </div>
    {pending && <p className="mt-2 text-xs text-white/60">Waiting for the app. If DVNT is not installed or the link does not open it, stay here; your draft is safe. This step needs an app version supporting Live Photo pickup. The pickup expires after 15 minutes.</p>}
    {ready && <p className="mt-2 text-sm text-cyan-300">{saved?.applied ? 'Live Photos received.' : 'Live Photos are ready to add to your saved draft.'}</p>}
    {(state === 'expired' || state === 'cancelled') && <p className="mt-2 text-sm">Pickup ended. Restore your saved draft, then cancel this pickup to start again.</p>}
    {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
    {notice.startsWith('This restores') && <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={replaceConfirmed} onChange={event => setReplaceConfirmed(event.target.checked)} />Replace the draft on this screen with my saved draft</label>}
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </section>;
}
