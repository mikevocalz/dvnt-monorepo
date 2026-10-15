import type { CollectionBeforeChangeHook, CollectionSlug } from "payload";
import {
  validateEditorialReview,
  type ReviewMutation,
} from "../../editorial/review-gate.ts";
import type { EditorialStage } from "../../editorial/lanes";

const STAGES = new Set<EditorialStage>([
  "draft", "review", "approved", "scheduled", "published", "paused", "rejected",
]);

function canonicalStage(value: unknown): EditorialStage {
  if (typeof value !== "string" || !STAGES.has(value as EditorialStage)) {
    throw new Error("Invalid editorial workflow stage");
  }
  return value as EditorialStage;
}

function idFromRelation(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" || typeof id === "number" ? id : null;
  }
  return null;
}

/**
 * A Payload admin cannot approve as someone else or force "published" via the
 * JSON API. There is no background publisher in this PR: scheduling is a
 * reviewed record, not an action that writes a DVNT post.
 */
export const enforceEditorialReview: CollectionBeforeChangeHook = async ({
  data, originalDoc, req, operation,
}) => {
  const actorId = idFromRelation(req.user?.id);
  const previousStage = operation === "create"
    ? null
    : canonicalStage(originalDoc?.stage ?? "draft");
  const nextStage = canonicalStage(data.stage ?? originalDoc?.stage ?? "draft");
  const channelId = idFromRelation(data.channel ?? originalDoc?.channel);
  if (channelId == null) throw new Error("Choose a valid editorial channel first");

  // Find live channel settings on every approval/scheduling change; stale
  // client copies of disabled/renamed categories are not authorization.
  const channel = await req.payload.findByID({
    collection: "editorial-channels" as CollectionSlug,
    id: channelId,
    depth: 0,
    req,
  });
  if (!channel) throw new Error("Editorial channel unavailable");
  const channelRecord = channel as unknown as Record<string, unknown>;
  const sourcePolicyRaw = channelRecord.sourcePolicy;
  const sourcePolicy: ReviewMutation["sourcePolicy"] =
    sourcePolicyRaw === "opinion" || sourcePolicyRaw === "entertainment"
      ? sourcePolicyRaw : "verified-sources";

  const sourceUrl = data.sourceUrl ?? originalDoc?.sourceUrl;
  const scheduledAt = data.scheduledAt ?? originalDoc?.scheduledAt;
  const operationKey = data.publishOperationKey ?? originalDoc?.publishOperationKey;
  const decision = validateEditorialReview({
    previousStage,
    nextStage,
    actorId: actorId == null ? null : String(actorId),
    sourcePolicy,
    sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null,
    channelEnabled: channelRecord.enabled === true,
    scheduledAt: typeof scheduledAt === "string" ? scheduledAt : null,
    publishOperationKey: typeof operationKey === "string" ? operationKey : null,
  });
  if (decision) throw new Error(`Editorial review refused: ${decision}`);

  // A client cannot forge the person who approved a review. Bind it to the
  // authenticated moderator/admin when the review actually advances.
  if (previousStage === "review" && nextStage === "approved") {
    data.approvedBy = actorId;
  } else {
    data.approvedBy = originalDoc?.approvedBy ?? null;
  }

  // An admin clicking a checkbox isn't a publisher. There is no public post ID
  // until an authorized, independently audited delivery worker exists.
  data.publishedPostId = originalDoc?.publishedPostId ?? null;
  data.stage = nextStage;
  return data;
};
