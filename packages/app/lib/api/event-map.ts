import { supabase } from "../supabase/client";
import { eventMapIds, type EventMapLocation } from "../events/event-map";

export const eventMapApi = {
  async getLocations(ids: readonly string[], signal?: AbortSignal): Promise<EventMapLocation[]> {
    const safeIds = eventMapIds(ids);
    const result: EventMapLocation[] = [];
    // Bound each request; only events already present in the filtered list are
    // requested. Admission is in the server query BEFORE coordinates are sent.
    for (let offset = 0; offset < safeIds.length; offset += 100) {
      let query = supabase.from("events").select(
        "id,title,visibility,is_hidden,publish_at,status,is_online,location_type,location,location_name,location_lat,location_lng",
      ).in("id", safeIds.slice(offset, offset + 100))
        .or("visibility.is.null,visibility.eq.public")
        .or("is_hidden.is.null,is_hidden.eq.false")
        .or(`publish_at.is.null,publish_at.lte.${new Date().toISOString()}`)
        .or("status.is.null,status.in.(active,postponed)")
        .or("is_online.is.null,is_online.eq.false")
        .or("location_type.is.null,location_type.neq.virtual");
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw new Error("Event locations could not be loaded. Please retry.");
      result.push(...((data || []) as EventMapLocation[]));
    }
    return result;
  },
};
