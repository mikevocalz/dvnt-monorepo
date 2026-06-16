import { supabase } from "../supabase/client";
import { DB } from "../supabase/db-map";
import type { City } from "../stores/events-location-store";

export const citiesApi = {
  /**
   * Get all cities ordered by population (descending)
   */
  async getCities(): Promise<City[]> {
    const { data, error } = await supabase
      .from(DB.cities.table)
      .select(
        `${DB.cities.id}, ${DB.cities.name}, ${DB.cities.state}, ${DB.cities.country}, ${DB.cities.lat}, ${DB.cities.lng}, ${DB.cities.timezone}, ${DB.cities.slug}`,
      )
      .order("population", { ascending: false });

    if (error) {
      console.error("[Cities] getCities error:", error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row[DB.cities.id],
      name: row[DB.cities.name],
      state: row[DB.cities.state],
      country: row[DB.cities.country],
      lat: row[DB.cities.lat],
      lng: row[DB.cities.lng],
      timezone: row[DB.cities.timezone],
      slug: row[DB.cities.slug],
    }));
  },

  /**
   * Search cities by name
   */
  async searchCities(query: string): Promise<City[]> {
    if (!query || query.length < 1) return [];

    const { data, error } = await supabase
      .from(DB.cities.table)
      .select(
        `${DB.cities.id}, ${DB.cities.name}, ${DB.cities.state}, ${DB.cities.country}, ${DB.cities.lat}, ${DB.cities.lng}, ${DB.cities.timezone}, ${DB.cities.slug}`,
      )
      .ilike(DB.cities.name, `%${query}%`)
      .order("population", { ascending: false })
      .limit(10);

    if (error) {
      console.error("[Cities] searchCities error:", error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row[DB.cities.id],
      name: row[DB.cities.name],
      state: row[DB.cities.state],
      country: row[DB.cities.country],
      lat: row[DB.cities.lat],
      lng: row[DB.cities.lng],
      timezone: row[DB.cities.timezone],
      slug: row[DB.cities.slug],
    }));
  },
};
