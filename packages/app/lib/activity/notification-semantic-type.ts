/** Legacy readers understand system title/body; current readers restore only our known semantics.
 * This is display compatibility, NOT an access grant or a substitute for native rollout.
 */
export function notificationSemanticType(type: string, payload: unknown): string {
  if (type !== "system" || !payload || typeof payload !== "object") return type;
  const semantic = (payload as { semantic_type?: unknown }).semantic_type;
  return semantic === "follow_request" || semantic === "follow_request_approved"
    ? semantic : type;
}
