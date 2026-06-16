/**
 * Predicate-based cache propagation.
 *
 * When a mutation changes an entity (event, user, ticket, comment, post),
 * the SAME entity may appear in many cached queries — event detail, the
 * feed, search results, a profile's hosted-events tab, ticket-detail
 * embedding event, etc. Hand-enumerating every key per mutation is
 * fragile; adding a new screen means remembering to update every
 * mutation hook that produces an event.
 *
 * This module provides one predicate ("does this query contain entity X?")
 * + one walker ("patch the matching entity wherever it lives in the
 * query's data") so a single mutation can update every cache that
 * happens to reference the entity, regardless of query-key shape.
 *
 * Usage:
 *   const snapshot = snapshotMatchingQueries(qc, eventPredicate(eventId));
 *   propagateEntity(qc, "event", eventId, patch);
 *   // on error:
 *   rollback(qc, snapshot);
 *
 * Pairs with the existing targeted helpers in lib/query/patch.ts — that
 * file remains canonical when you know the exact query key and want a
 * minimal, type-safe update. This file is for mutations that affect
 * an entity wherever-it-may-appear.
 */

import type { QueryClient, QueryKey, Query } from "@tanstack/react-query";

export type EntityType = "event" | "user" | "ticket" | "comment" | "post";

/**
 * Walks any cached data shape and applies `patch` to every entity
 * matching `(entityType, entityId)`. Returns a NEW data object — never
 * mutates in place. Handles:
 *   - single entity ({ id })
 *   - flat arrays ([{ id }, ...])
 *   - TanStack Infinite Query pages ({ pages: [{ data | posts | items | events: [...] }] })
 *   - nested-event references (e.g. ticket.event_id matching)
 */
export function patchEntityInQueryData(
  data: any,
  entityType: EntityType,
  entityId: string | number,
  patch: Record<string, unknown>,
): any {
  if (data == null) return data;
  const idStr = String(entityId);

  // 1. Single entity at top level
  if (matches(data, entityType, idStr)) {
    return { ...data, ...patch };
  }

  // 2. Single entity wrapped in { ok, ...entity, ... }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    // 2a. Nested entity reference (e.g. ticket.event matches event)
    const nestedKey = nestedKeyFor(entityType);
    if (nestedKey && data[nestedKey] && matches(data[nestedKey], entityType, idStr)) {
      return { ...data, [nestedKey]: { ...data[nestedKey], ...patch } };
    }

    // 2b. Infinite-query shape: { pages, pageParams }
    if (Array.isArray(data.pages)) {
      const newPages = data.pages.map((page: any) =>
        patchPageData(page, entityType, idStr, patch),
      );
      return newPages.some((p: any, i: number) => p !== data.pages[i])
        ? { ...data, pages: newPages }
        : data;
    }

    // 2c. Container with a known list field at top level
    for (const field of LIST_FIELDS) {
      if (Array.isArray(data[field])) {
        const patched = data[field].map((item: any) =>
          matches(item, entityType, idStr) ? { ...item, ...patch } : item,
        );
        if (patched.some((it: any, i: number) => it !== data[field][i])) {
          return { ...data, [field]: patched };
        }
      }
    }

    return data;
  }

  // 3. Flat array
  if (Array.isArray(data)) {
    const patched = data.map((item: any) =>
      matches(item, entityType, idStr) ? { ...item, ...patch } : item,
    );
    return patched.some((it, i) => it !== data[i]) ? patched : data;
  }

  return data;
}

const LIST_FIELDS = [
  "data",
  "items",
  "events",
  "posts",
  "tickets",
  "users",
  "comments",
] as const;

function patchPageData(
  page: any,
  entityType: EntityType,
  idStr: string,
  patch: Record<string, unknown>,
): any {
  if (!page || typeof page !== "object") return page;
  for (const field of LIST_FIELDS) {
    if (Array.isArray(page[field])) {
      const newList = page[field].map((item: any) =>
        matches(item, entityType, idStr) ? { ...item, ...patch } : item,
      );
      if (newList.some((it: any, i: number) => it !== page[field][i])) {
        return { ...page, [field]: newList };
      }
    }
  }
  return page;
}

/** When an entity-type's row is commonly nested under a parent (ticket
 *  embeds `event`, comment embeds `post`), match against that nested
 *  field too. Returning null means "no nested matching for this type". */
function nestedKeyFor(entityType: EntityType): string | null {
  switch (entityType) {
    case "event":
      // tickets / orders nest event details
      return "event";
    case "user":
      // posts / comments / events nest author/host
      return "author";
    default:
      return null;
  }
}

function matches(
  item: any,
  entityType: EntityType,
  idStr: string,
): boolean {
  if (!item || typeof item !== "object") return false;
  // Direct id match
  if (item.id != null && String(item.id) === idStr) return true;
  // Type-specific match fields
  switch (entityType) {
    case "event":
      if (item.event_id != null && String(item.event_id) === idStr) return true;
      if (item.eventId != null && String(item.eventId) === idStr) return true;
      break;
    case "user":
      if (item.user_id != null && String(item.user_id) === idStr) return true;
      if (item.userId != null && String(item.userId) === idStr) return true;
      if (item.author_id != null && String(item.author_id) === idStr) return true;
      if (item.authId != null && String(item.authId) === idStr) return true;
      break;
    case "ticket":
      if (item.ticket_id != null && String(item.ticket_id) === idStr) return true;
      break;
    case "comment":
      if (item.comment_id != null && String(item.comment_id) === idStr) return true;
      break;
    case "post":
      if (item.post_id != null && String(item.post_id) === idStr) return true;
      break;
  }
  return false;
}

/** Returns true if any query data this client holds appears to contain
 *  the given entity. Use as a TanStack `predicate`. */
export function queryContainsEntity(
  entityType: EntityType,
  entityId: string | number,
): (query: Query) => boolean {
  const idStr = String(entityId);
  return (query: Query) => {
    // Heuristic 1: query-key shape (cheap, no data inspection)
    const [domain, ...rest] = query.queryKey as ReadonlyArray<unknown>;
    if (typeof domain === "string") {
      const dom = domain.toLowerCase();
      if (entityType === "event" && (dom === "events" || dom === "event")) return true;
      if (entityType === "user" && (dom === "user" || dom === "users" || dom === "profile" || dom === "profileposts")) return true;
      if (entityType === "ticket" && (dom === "tickets" || dom === "ticket" || dom === "mytickets")) return true;
      if (entityType === "comment" && (dom === "comments" || dom === "comment")) return true;
      if (entityType === "post" && (dom === "posts" || dom === "post" || dom === "feed")) return true;
    }
    // Heuristic 2: id appears in queryKey segments (e.g. ['event', '38'])
    if (rest.some((seg) => String(seg) === idStr)) return true;
    // Heuristic 3: data already contains the entity (verifies the heuristic
    // 1 candidates without false negatives on bespoke query domains)
    return queryDataContains(query.state.data, entityType, idStr);
  };
}

function queryDataContains(
  data: any,
  entityType: EntityType,
  idStr: string,
): boolean {
  if (data == null) return false;
  if (matches(data, entityType, idStr)) return true;
  if (Array.isArray(data)) return data.some((it) => matches(it, entityType, idStr));
  if (typeof data !== "object") return false;
  if (Array.isArray(data.pages)) {
    return data.pages.some((p: any) =>
      LIST_FIELDS.some(
        (f) =>
          Array.isArray(p?.[f]) &&
          p[f].some((it: any) => matches(it, entityType, idStr)),
      ),
    );
  }
  for (const field of LIST_FIELDS) {
    if (Array.isArray(data[field]) && data[field].some((it: any) => matches(it, entityType, idStr))) {
      return true;
    }
  }
  // Nested ref
  const nk = nestedKeyFor(entityType);
  if (nk && data[nk] && matches(data[nk], entityType, idStr)) return true;
  return false;
}

/** Apply `patch` to every cached query whose data appears to reference
 *  the entity. Idempotent — safe to call repeatedly during onMutate/onSuccess. */
export function propagateEntity(
  queryClient: QueryClient,
  entityType: EntityType,
  entityId: string | number,
  patch: Record<string, unknown>,
): void {
  const predicate = queryContainsEntity(entityType, entityId);
  queryClient.setQueriesData({ predicate }, (old: unknown) =>
    patchEntityInQueryData(old, entityType, entityId, patch),
  );
}

/** Capture pre-mutation snapshot so onError can roll back. */
export function snapshotMatchingQueries(
  queryClient: QueryClient,
  predicate: (q: Query) => boolean,
): Array<[QueryKey, unknown]> {
  return queryClient.getQueriesData({ predicate }) as Array<[QueryKey, unknown]>;
}

/** Restore a snapshot taken via snapshotMatchingQueries. */
export function rollback(
  queryClient: QueryClient,
  snapshot: Array<[QueryKey, unknown]>,
): void {
  for (const [key, data] of snapshot) {
    queryClient.setQueryData(key, data);
  }
}
