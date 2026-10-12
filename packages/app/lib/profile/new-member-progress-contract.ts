import type { NewMemberProgress } from "./new-member-progress.ts";

/** Only complete server evidence may determine the required setup screen. */
export function readNewMemberProgress(value: unknown): NewMemberProgress {
  const data = value as Partial<NewMemberProgress> | null;
  const validStep = data?.step === "pending_verification" || data?.step === "photo" ||
    data?.step === "first_post" || data?.step === "complete";
  const hasEvidence = data && [data.hasPhoto, data.hasPost, data.emailVerified, data.adultVerified]
    .every((field) => typeof field === "boolean");
  const consistent = data && data.required === (data.step !== "complete") &&
    (data.step !== "pending_verification" || data.emailVerified === false || data.adultVerified === false) &&
    (data.step !== "photo" || data.hasPhoto === false) &&
    (data.step !== "first_post" || (data.hasPhoto === true && data.hasPost === false)) &&
    (data.step !== "complete" || (data.hasPhoto === true && data.hasPost === true));
  if (!validStep || !hasEvidence || !consistent) {
    throw new Error("Profile setup is temporarily unavailable. Please retry.");
  }
  return data as NewMemberProgress;
}
