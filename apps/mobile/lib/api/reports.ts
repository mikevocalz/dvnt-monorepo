/**
 * Universal content reporting client.
 *
 * Files a report against any UGC surface (post, comment, event, story,
 * profile, message). App Store Guideline 1.2 requires this for every
 * user-generated content surface in the app.
 *
 * Lynk private video rooms use a separate dedicated path
 * (reports_video_rooms + the in-room report sheet).
 *
 * Usage:
 *   await reportsApi.reportContent({
 *     entityType: "post",
 *     entityId: String(post.id),
 *     reason: "harassment_bullying",
 *     details: "Optional free-text",
 *   });
 *
 * Idempotent: re-reporting the same entity returns the existing open
 * report instead of stacking duplicates.
 */

import { invokeEdge } from "./invoke-edge";

export type ReportEntityType =
  | "post"
  | "comment"
  | "event"
  | "story"
  | "profile"
  | "message";

export type ReportReason =
  | "spam"
  | "harassment_bullying"
  | "hate_speech"
  | "violence_threats"
  | "sexual_content"
  | "minor_safety"
  | "self_harm"
  | "misinformation"
  | "impersonation"
  | "other";

export interface ReportContentInput {
  entityType: ReportEntityType;
  entityId: string;
  reason: ReportReason;
  details?: string;
}

export interface ReportContentResult {
  id: string;
  alreadyReported: boolean;
}

/**
 * Human-readable label for each reason — used in the ReportSheet picker.
 * Order = picker order (most-reported categories first).
 */
export const REPORT_REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam or scam" },
  { value: "harassment_bullying", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "violence_threats", label: "Violence or threats" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "minor_safety", label: "Child safety" },
  { value: "self_harm", label: "Self-harm" },
  { value: "misinformation", label: "False information" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Something else" },
];

export const reportsApi = {
  async reportContent(input: ReportContentInput): Promise<ReportContentResult> {
    const { data, error } = await invokeEdge<{
      ok?: boolean;
      id?: string;
      already_reported?: boolean;
      error?: string;
    }>("report-content", {
      entity_type: input.entityType,
      entity_id: input.entityId,
      reason: input.reason,
      details: input.details,
    });

    if (error) {
      console.error("[Reports] reportContent error:", error.message);
      throw new Error(error.message || "Failed to file report");
    }
    if (!data?.ok || !data.id) {
      const message = data?.error || "Failed to file report";
      console.error("[Reports] reportContent failed:", message);
      throw new Error(message);
    }

    return { id: data.id, alreadyReported: !!data.already_reported };
  },
};
