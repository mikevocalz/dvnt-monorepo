import { supabase } from "@dvnt/app/lib/supabase/client";
import { useFirstPostOfferStore } from "@dvnt/app/lib/stores/first-post-offer-store";
import {
  isPublicEventVisibility,
  type ConfirmedEvent,
} from "@dvnt/app/lib/posts/first-post-draft";

/**
 * The confirmed event behind a first-post draft: name, visibility, city.
 *
 * Read straight off the event row rather than the detail RPC, which returns no
 * city and folds nothing. The address columns are deliberately not selected —
 * a venue address cannot leak into a draft it was never fetched for.
 *
 * Returns null when the row is missing or RLS hides it. Callers treat that as
 * ineligible, which is the same answer they give for a private event.
 */
export async function fetchFirstPostEvent(
  eventId: number,
): Promise<ConfirmedEvent | null> {
  const read = (columns: string) =>
    supabase.from("events").select(columns).eq("id", eventId).maybeSingle();

  // A broken city embed must not take the whole offer down with it: fall back
  // to the event alone, which costs the city hashtag and nothing else.
  let { data, error } = await read("id, title, visibility, cities(name)");
  if (error) ({ data, error } = await read("id, title, visibility"));

  if (error || !data) return null;

  const row = data as unknown as {
    id: number;
    title: string | null;
    visibility: string | null;
    cities?: { name?: string | null } | { name?: string | null }[] | null;
  };
  const city = Array.isArray(row.cities) ? row.cities[0] : row.cities;

  return {
    id: Number(row.id),
    title: row.title,
    visibility: row.visibility,
    cityName: city?.name ?? null,
  };
}

/**
 * Publication-time recheck. An event that flipped to private while the draft
 * sat in the composer must not publish, and a network failure here counts as
 * "not provably public" rather than "probably fine".
 *
 * A composer with no first-post draft in it returns immediately.
 */
export async function assertFirstPostPublishable(): Promise<void> {
  const eventId = useFirstPostOfferStore.getState().pendingEventId;
  if (eventId == null) return;

  let event: ConfirmedEvent | null = null;
  try {
    event = await fetchFirstPostEvent(eventId);
  } catch {
    throw new Error("Could not confirm this event is still public. Try again.");
  }

  if (!isPublicEventVisibility(event?.visibility)) {
    useFirstPostOfferStore.getState().clearPending();
    throw new Error(
      "This event is no longer public, so this draft can't be posted. Edit the text to remove the event first.",
    );
  }
}
