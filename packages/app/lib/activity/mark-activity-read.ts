import { activityKeys } from "../query-keys";

/** Keep the rendered query in sync with persistence; a failed read is not success. */
export async function markActivityRead(
  queryClient: any,
  viewerId: string,
  activity: { id: string; isRead: boolean },
  persist: (id: string) => Promise<void>,
  currentViewerId: () => string,
  onError: () => void,
): Promise<void> {
  const key = activityKeys.list(viewerId);
  queryClient.setQueryData(key, (old: any[] | undefined) =>
    old?.map((row) => row.id === activity.id ? { ...row, isRead: true } : row));
  try {
    await persist(activity.id);
  } catch {
    if (currentViewerId() === viewerId) {
      queryClient.setQueryData(key, (old: any[] | undefined) =>
        old?.map((row) => row.id === activity.id ? { ...row, isRead: activity.isRead } : row));
      onError();
    }
  } finally {
    if (currentViewerId() === viewerId) {
      // Reconcile with server after either outcome, including concurrent reads.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key, exact: true }),
        queryClient.invalidateQueries({ queryKey: ["badges", viewerId], exact: true }),
      ]).catch(() => { /* Keep cache; normal query retry handles failed reconciliation. */ });
    }
  }
}

export async function markAllActivityRead(
  queryClient: any,
  viewerId: string,
  persist: () => Promise<unknown>,
  currentViewerId: () => string,
  onError: () => void,
): Promise<void> {
  const key = activityKeys.list(viewerId);
  const badgesKey = ["badges", viewerId];
  const previous = queryClient.getQueryData(key) as any[] | undefined;
  const previousBadges = queryClient.getQueryData(badgesKey);
  const previousRead = new Map((previous || []).map((row) => [row.id, row.isRead]));
  queryClient.setQueryData(key, (old: any[] | undefined) => old?.map(row => ({ ...row, isRead: true })));
  // Without a canonical snapshot, do not invent a badge value that cannot be rolled back.
  if (previousBadges !== undefined) {
    queryClient.setQueryData(badgesKey, (old: any) => ({ ...old, unread: 0, unreadCount: 0 }));
  }
  try {
    await persist();
  } catch {
    if (currentViewerId() === viewerId) {
      // Keep newly arrived rows rather than restoring an obsolete whole page.
      queryClient.setQueryData(key, (old: any[] | undefined) => old?.map(row =>
        previousRead.has(row.id) ? { ...row, isRead: previousRead.get(row.id) } : row));
      if (previousBadges !== undefined) queryClient.setQueryData(badgesKey, previousBadges);
      onError();
    }
  } finally {
    if (currentViewerId() === viewerId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: key, exact: true }),
        queryClient.invalidateQueries({ queryKey: badgesKey, exact: true }),
      ]).catch(() => { /* Keep cache; normal query retry handles failed reconciliation. */ });
    }
  }
}
