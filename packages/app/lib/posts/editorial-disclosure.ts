/**
 * The AI-editorial disclosure a feed surface should show for a post, or null.
 *
 * Both fields are required. posts.disclosure_label is a plain text column an
 * author could write on their own post; posts.editorial_job_id is a FK into
 * editorial_jobs, which anon and authenticated cannot read, so a client cannot
 * supply a real one. Requiring the pair keeps the label on editorial output
 * and off member posts. Every surface (feed card, text card, masonry tile,
 * post detail) goes through this so they cannot disagree.
 */
export function editorialDisclosureLabel(post: {
  editorialJobId?: string | null;
  disclosureLabel?: string | null;
}): string | null {
  const label = post.disclosureLabel?.trim();
  if (!post.editorialJobId?.trim() || !label) return null;
  return label;
}

/** Screen-reader text for the disclosure. */
export function editorialDisclosureA11y(label: string): string {
  return `${label}. This post was produced by DVNT editorial automation.`;
}
