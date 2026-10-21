/** Server-owned story shares. The SQL transaction resolves all source data. */
export interface StoryShareInput {
  sharedSource: { type: "post" | "event"; id: string };
  operationId: string;
  expectedViewerId?: string;
  visibility: "public";
}

export type StoryShareValidation =
  | { ok: true; value: StoryShareInput }
  | { ok: false; code: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Accept identifiers only; never forward author, URL, title or DM metadata. */
export function validateStoryShare(body: Record<string, unknown>): StoryShareValidation {
  const source = body.sharedSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { ok: false, code: "validation_error", message: "sharedSource must identify a post or event" };
  }
  const { type, id } = source as Record<string, unknown>;
  if ((type !== "post" && type !== "event") || typeof id !== "string" ||
      !/^[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return { ok: false, code: "validation_error", message: "sharedSource must have a valid type and positive ID" };
  }
  if (typeof body.operationId !== "string" || !UUID.test(body.operationId)) {
    return { ok: false, code: "validation_error", message: "A UUID operationId is required to share a story" };
  }
  if (body.expectedViewerId !== undefined && (typeof body.expectedViewerId !== "string" ||
      !/^[1-9]\d{0,14}$/.test(body.expectedViewerId))) {
    return { ok: false, code: "validation_error", message: "expectedViewerId must be a positive user ID" };
  }
  const visibility = body.visibility === undefined ? "public" : body.visibility;
  // Legacy story audience policies do not enforce restricted audiences on the
  // server. Until they do, new attributed shares must fail closed to public.
  if (visibility !== "public") {
    return { ok: false, code: "validation_error", message: "Shared stories must be public" };
  }
  return { ok: true, value: {
    sharedSource: { type, id }, operationId: body.operationId.toLowerCase(),
    ...(body.expectedViewerId === undefined ? {} : { expectedViewerId: body.expectedViewerId as string }),
    visibility,
  } };
}

/** Only create-story's atomic transaction can mint this notification kind. */
export function hasReservedStoryShareMetadata(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" &&
    !Array.isArray(metadata) && (metadata as Record<string, unknown>).type === "story_share";
}
