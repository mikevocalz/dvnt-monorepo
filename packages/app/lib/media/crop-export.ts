export type CropExportMime = "image/jpeg" | "image/png" | "image/webp";

export function cropExportMimeType(format: "jpeg" | "png" | "webp"): CropExportMime {
  return `image/${format}`;
}

/** Preserve the order and identity of untouched attachments and their tag indices. */
export function replaceCroppedMedia<T extends { id: string }>(current: readonly T[], edited: readonly T[]): T[] {
  const byId = new Map(edited.map((entry) => [entry.id, entry]));
  return current.map((entry) => byId.get(entry.id) ?? entry);
}

type CropExportCheck = { ok: true; mimeType: CropExportMime } | { ok: false; error: string };

/** Only explicitly marked, sanitized still exports may skip the second encode. */
export async function inspectCropExport(
  file: { uri: string; type: string; kind?: string; cropExportMimeType?: CropExportMime },
  limitBytes: number,
  byteSize: (uri: string) => Promise<number | null>,
): Promise<CropExportCheck | null> {
  const mimeType = file.cropExportMimeType;
  if (file.type !== "image" || file.kind !== "image" ||
      (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp")) return null;
  const size = await byteSize(file.uri).catch(() => null);
  if (size === null || !Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "The edited photo could not be read. Please reopen the editor and save it again." };
  }
  if (size > limitBytes) {
    return { ok: false, error: `The edited photo exceeds the ${limitBytes / (1024 * 1024)} MB upload limit. Choose a smaller Max Edge or lower quality in the editor.` };
  }
  return { ok: true, mimeType };
}
