import { createStore } from "zustand/vanilla";

export interface FollowupSettings {
  enabled: boolean; subject: string | null; message: string; cta_label: string; delay_minutes: number;
  status: string; scheduled_at?: string | null; sent_count?: number; failed_count?: number;
}
const defaults: FollowupSettings = { enabled: false, subject: null, message: "", cta_label: "Leave a review", delay_minutes: 600, status: "disabled" };
export function followupTiming(minutes: number) {
  return minutes % 60 === 0 ? `${minutes / 60} hours after the event ends` : `${minutes} minutes after the event ends`;
}
export function createFollowupSettingsStore(eventId: number, api: {
  load(id: number): Promise<FollowupSettings>; save(id: number, settings: FollowupSettings): Promise<FollowupSettings>;
}) {
  let alive = true, generation = 0;
  const store = createStore(() => ({ loading: true, saving: false, settings: null as FollowupSettings | null,
    enabled: false, error: "", saved: false }));
  async function load() {
    if (!alive || store.getState().saving) return;
    const request = ++generation;
    store.setState({ loading: true, settings: null, error: "", saved: false });
    try {
      const settings = { ...defaults, ...await api.load(eventId) };
      if (alive && request === generation) store.setState({ loading: false, settings, enabled: settings.enabled });
    } catch (error) {
      if (alive && request === generation) store.setState({ loading: false, error: error instanceof Error ? error.message : "Email settings unavailable" });
    }
  }
  return { store, load,
    activate() { alive = true; },
    dispose() { alive = false; generation++; },
    toggle(enabled: boolean) { if (alive && store.getState().settings && !store.getState().saving) store.setState({ enabled, saved: false }); },
    async save() {
      const state = store.getState();
      if (!alive || state.saving || !state.settings || state.enabled === state.settings.enabled) return;
      const request = ++generation;
      store.setState({ saving: true, error: "", saved: false });
      try {
        // Preserve organizer copy/timing: this control changes only opt-in.
        const settings = { ...defaults, ...await api.save(eventId, { ...state.settings, enabled: state.enabled }) };
        if (alive && request === generation) store.setState({ saving: false, settings, enabled: settings.enabled, saved: true });
      } catch (error) {
        if (alive && request === generation) store.setState({ saving: false, settings: null, error: `${error instanceof Error ? error.message : "Could not save email settings"}. Reload to confirm the saved setting before retrying.` });
      }
    },
  };
}
