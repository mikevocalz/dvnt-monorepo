/** Sharing a link never grants room access or changes a guest's device choices. */
export function roomShareCopy(title: string, isPublic?: boolean) {
  return {
    text: isPublic === false ? `Open "${title}" on DVNT. This private Lynk requires access.` : `Join "${title}" on DVNT`,
    confirmation: isPublic === false ? "Only people with access can join this private Lynk." : "Guests review their camera and microphone before joining. Room access rules still apply.",
  };
}

export type RoomLinkShareResult = "shared" | "copied" | "cancelled" | "failed" | "stale";

/** Recheck ownership before fallback transmission or feedback after an OS sheet. */
export async function shareRoomLink({ title, text, url, isCurrent, share, copy }: {
  title: string;
  text: string;
  url: string;
  isCurrent: () => boolean;
  share?: (data: { title: string; text: string; url: string }) => Promise<void>;
  copy?: (text: string) => Promise<void>;
}): Promise<RoomLinkShareResult> {
  if (!isCurrent()) return "stale";
  if (share) {
    try {
      await share({ title, text, url });
      return isCurrent() ? "shared" : "stale";
    } catch (error) {
      if (!isCurrent()) return "stale";
      if ((error as { name?: string })?.name === "AbortError") return "cancelled";
    }
  }
  if (!isCurrent()) return "stale";
  if (!copy) return "failed";
  try {
    await copy(`${text}\n${url}`);
    return isCurrent() ? "copied" : "stale";
  } catch {
    return isCurrent() ? "failed" : "stale";
  }
}
