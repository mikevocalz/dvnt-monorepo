import { useQuery } from "@tanstack/react-query";
import { citiesApi } from "@/lib/api/cities";

export const cityKeys = {
  all: ["cities"] as const,
  list: () => [...cityKeys.all, "list"] as const,
  search: (query: string) => [...cityKeys.all, "search", query] as const,
};

export function useCities() {
  return useQuery({
    queryKey: cityKeys.list(),
    queryFn: () => citiesApi.getCities(),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours — cities rarely change
  });
}

export function useCitySearch(query: string) {
  return useQuery({
    queryKey: cityKeys.search(query),
    queryFn: () => citiesApi.searchCities(query),
    enabled: query.length >= 1,
    staleTime: 5 * 60 * 1000, // 5 min
  });
}
