/**
 * Editorial review cannot be bypassed with a hand-edited Payload stage field.
 * This policy has no side effects; Payload's beforeChange hook owns the write.
 */
import type { EditorialStage } from "./lanes";

export type ReviewRefusal =
  | "missing_reviewer"
  | "invalid_transition"
  | "source_required"
  | "channel_disabled"
  | "schedule_required"
  | "operation_required"
  | "publisher_not_installed";

export interface ReviewMutation {
  previousStage: EditorialStage | null;
  nextStage: EditorialStage;
  actorId: string | null;
  sourcePolicy: "verified-sources" | "entertainment" | "opinion";
  sourceUrl: string | null;
  channelEnabled: boolean;
  scheduledAt: string | null;
  publishOperationKey: string | null;
}

const ALLOWED: Record<EditorialStage | "new", readonly EditorialStage[]> = {
  new: ["draft"],
  draft: ["draft", "review", "rejected"],
  review: ["review", "draft", "approved", "rejected"],
  approved: ["approved", "scheduled", "draft", "rejected"],
  scheduled: ["scheduled", "paused", "draft"],
  paused: ["paused", "scheduled", "draft", "rejected"],
  rejected: ["rejected", "draft"],
  published: ["published"],
};

export function isHttpsEditorialSource(value: string | null): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    // No embedded user:pass, script/data, or localhost masquerading as news.
    return url.protocol === "https:" && !url.username && !url.password &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function validateEditorialReview(m: ReviewMutation): ReviewRefusal | null {
  if (!m.actorId) return "missing_reviewer";
  if (!ALLOWED[m.previousStage ?? "new"].includes(m.nextStage)) {
    return "invalid_transition";
  }
  // There is intentionally no publisher on this branch. Hand-editing the
  // status to "published" is neither successful publication nor evidence.
  if (m.nextStage === "published") return "publisher_not_installed";

  if (m.nextStage === "approved" || m.nextStage === "scheduled") {
    if (m.sourcePolicy === "verified-sources" && !isHttpsEditorialSource(m.sourceUrl)) {
      return "source_required";
    }
  }
  if (m.nextStage === "scheduled") {
    if (!m.channelEnabled) return "channel_disabled";
    if (!m.scheduledAt || !Number.isFinite(Date.parse(m.scheduledAt))) {
      return "schedule_required";
    }
    if (!m.publishOperationKey || !/^[A-Za-z0-9:_-]{8,128}$/.test(m.publishOperationKey)) {
      return "operation_required";
    }
  }
  return null;
}
