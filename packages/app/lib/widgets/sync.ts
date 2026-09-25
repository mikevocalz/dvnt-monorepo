/**
 * App-facing widget sync (shared, native-free).
 *
 * Builds the SAFE-ONLY dataset (dataset.ts) and hands it to a platform backend
 * that writes it into the App Group and reloads the iOS widget timelines. The
 * native backend (expo-widgets + @expo/ui) is registered by the mobile app at
 * boot via `registerWidgetBackend` — see apps/mobile/widgets/backend.ts. On web
 * / Android / before registration this is a safe no-op.
 *
 * Spicy filtering is already applied by buildWidgetDataset, so a backend can
 * never receive unsafe content.
 */
import { buildWidgetDataset } from "./dataset";
import type { WidgetDataset, WidgetSyncSources } from "./types";

export interface WidgetBackend {
  /** Persist the safe dataset to the App Group and reload widget timelines. */
  write(dataset: WidgetDataset): void | Promise<void>;
}

let backend: WidgetBackend | null = null;

export function registerWidgetBackend(next: WidgetBackend | null): void {
  backend = next;
}

export function hasWidgetBackend(): boolean {
  return backend != null;
}

/**
 * Build the safe dataset from raw sources and write it to the widget store.
 * Returns the dataset that was produced (also useful for tests/telemetry).
 */
export async function syncWidgets(sources: WidgetSyncSources): Promise<WidgetDataset> {
  const dataset = buildWidgetDataset(sources);
  try {
    await backend?.write(dataset);
  } catch (err) {
    console.warn("[widgets] sync failed:", err);
  }
  return dataset;
}
