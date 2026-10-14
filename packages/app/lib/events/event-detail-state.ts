interface QueryActivity {
  isPending: boolean;
  isFetching: boolean;
}

/** Wait only for the selected route's reads, never for data a finished query lacks. */
export function eventDetailIsResolving({
  hasResolvedId,
  hasSlug,
  detail,
  isTokenRoute,
  token,
  list,
  index,
}: {
  hasResolvedId: boolean;
  hasSlug: boolean;
  detail: QueryActivity;
  isTokenRoute: boolean;
  token: QueryActivity;
  list: QueryActivity;
  index: QueryActivity;
}): boolean {
  if (hasResolvedId) return detail.isPending || detail.isFetching;
  if (!hasSlug) return false;
  if (isTokenRoute) return token.isPending || token.isFetching;
  return list.isPending || list.isFetching || index.isPending || index.isFetching;
}
