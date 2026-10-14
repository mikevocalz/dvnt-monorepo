/** UI eligibility only; delete-comment verifies ownership on the server. */
export function canDeleteComment(
  signedIn: boolean,
  viewerUsername: string | undefined,
  comment: { id: string; username: string },
): boolean {
  return signedIn && !!viewerUsername && viewerUsername !== "unknown" &&
    viewerUsername === comment.username && /^[1-9]\d*$/.test(comment.id);
}

export function removeComment<T extends { id: string; replies?: T[] }>(
  comments: T[],
  id: string,
): T[] {
  return comments.filter((comment) => comment.id !== id).map((comment) =>
    comment.replies ? { ...comment, replies: removeComment(comment.replies, id) } : comment,
  );
}
