/**
 * Apple writes one UUID into both halves of a Live Photo: the still's Apple
 * MakerNote tag 0x0011 (ContentIdentifier) and the motion clip's QuickTime
 * metadata key `com.apple.quicktime.content.identifier`. Matching that UUID is
 * how Photos itself pairs them, so it can pair browser files without trusting
 * file names. Both readers return null on anything they don't recognise.
 */
const ascii = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
const MAKERNOTE = ascii("Apple iOS\0");
const CONTENT_KEY = "com.apple.quicktime.content.identifier";
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

function indexOf(bytes: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\0+$/, "").trim();
const uuidOrNull = (value: string) => (UUID.test(value) ? value.toUpperCase() : null);

/** JPEG or HEIC still. The MakerNote's IFD offsets are relative to its own start. */
export function stillContentId(bytes: Uint8Array): string | null {
  for (let start = indexOf(bytes, MAKERNOTE); start >= 0; start = indexOf(bytes, MAKERNOTE, start + 1)) {
    // "Apple iOS\0", 2-byte version, then the byte order mark.
    const order = String.fromCharCode(bytes[start + 12], bytes[start + 13]);
    if (order !== "MM" && order !== "II") continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset + start, bytes.length - start);
    const le = order === "II";
    if (view.byteLength < 16) continue;
    const count = view.getUint16(14, le);
    for (let i = 0; i < count; i++) {
      const entry = 16 + i * 12;
      if (entry + 12 > view.byteLength) break;
      if (view.getUint16(entry, le) !== 0x0011 || view.getUint16(entry + 2, le) !== 2) continue;
      const length = view.getUint32(entry + 4, le);
      const offset = length <= 4 ? entry + 8 : view.getUint32(entry + 8, le);
      if (offset + length > view.byteLength) return null;
      return uuidOrNull(text(bytes.subarray(start + offset, start + offset + length)));
    }
  }
  return null;
}

/** MOV/MP4: find the `keys` atom naming the content identifier, then its `ilst` value. */
export function motionContentId(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = indexOf(bytes, ascii("keys")); at >= 4; at = indexOf(bytes, ascii("keys"), at + 1)) {
    const box = at - 4;
    const size = view.getUint32(box);
    if (size < 16 || box + size > bytes.length) continue;
    const entries = view.getUint32(box + 12);
    let cursor = box + 16, index = 0;
    for (let i = 1; i <= entries && cursor + 8 <= box + size; i++) {
      const keySize = view.getUint32(cursor);
      if (keySize < 8 || cursor + keySize > box + size) break;
      if (text(bytes.subarray(cursor + 8, cursor + keySize)) === CONTENT_KEY) index = i;
      cursor += keySize;
    }
    if (!index) continue;
    // `ilst` follows `keys` inside the same `meta`; its children are typed by key index.
    const ilst = box + size;
    if (ilst + 8 > bytes.length || text(bytes.subarray(ilst + 4, ilst + 8)) !== "ilst") continue;
    const ilstEnd = Math.min(ilst + view.getUint32(ilst), bytes.length);
    for (let item = ilst + 8; item + 8 <= ilstEnd;) {
      const itemSize = view.getUint32(item);
      if (itemSize < 8) break;
      if (view.getUint32(item + 4) === index) {
        const data = item + 8; // size, "data", type, locale, value
        if (text(bytes.subarray(data + 4, data + 8)) !== "data") return null;
        return uuidOrNull(text(bytes.subarray(data + 16, Math.min(data + view.getUint32(data), bytes.length))));
      }
      item += itemSize;
    }
  }
  return null;
}

export async function readAppleContentId(file: Blob, kind: "still" | "motion"): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return kind === "still" ? stillContentId(bytes) : motionContentId(bytes);
  } catch {
    return null;
  }
}
