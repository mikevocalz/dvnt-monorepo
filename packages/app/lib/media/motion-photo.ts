/**
 * Android Motion Photos carry their motion clip inside the still file:
 * - JPEG (Google Pixel, Samsung): an MP4 appended after the image. XMP
 *   `GCamera:MotionPhoto="1"` lists it as the last `Container:Directory` item
 *   (Item:Length counted back from the end of the file); legacy `MicroVideo`
 *   files give `GCamera:MicroVideoOffset` instead. Samsung also indexes a
 *   `MotionPhoto_Data` record in the SEF trailer at the end of the file, the
 *   fallback when the XMP is missing.
 * - HEIC (Samsung One UI 6, Google's HEIF layout): a top-level `mpvd` box whose
 *   payload is the MP4.
 * Checked against immich-app/test-assets formats/motionphoto (Pixel 6 Pro,
 * Pixel 8a, Samsung One UI 5/6 JPEG, One UI 6 HEIC).
 *
 * Reads are small ranges: the first 256KB (JPEG XMP sits in APP1 there), the
 * last 64KB (SEF index, usually the MP4's moov) and box headers. The video
 * itself is never read, only located. Anything unrecognised returns null.
 */
export type MotionPhotoRanges = { stillEnd: number; videoStart: number; videoEnd: number };
type Fetch = (start: number, end: number) => Promise<Uint8Array>;

const HEAD_BYTES = 256 * 1024, TAIL_BYTES = 64 * 1024, MAX_BOXES = 64, MAX_SEF_ENTRIES = 64;
const ascii = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
const XMP_NS = ascii("http://ns.adobe.com/xap/1.0/\0");
const SEF_MOTION = 0x0a30;
// Top-level boxes an MP4 can end with. Samsung's trailing `sefd`/SEF index is not one.
const MP4_BOXES = new Set(["ftyp", "styp", "mdat", "moov", "moof", "mfra", "free", "skip", "wide", "uuid", "meta", "udta", "pdin", "sidx", "emsg", "prft"]);

const text = (b: Uint8Array, at: number, length: number) => {
  if (at < 0 || at + length > b.length) return "";
  let out = "";
  for (let i = at; i < at + length; i += 8192) out += String.fromCharCode(...b.subarray(i, Math.min(i + 8192, at + length)));
  return out;
};
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u32le = (b: Uint8Array, at: number) => ((b[at + 3] << 24) >>> 0) + (b[at + 2] << 16) + (b[at + 1] << 8) + b[at];
const startsWith = (b: Uint8Array, at: number, needle: Uint8Array) => {
  if (at < 0 || at + needle.length > b.length) return false;
  for (let i = 0; i < needle.length; i++) if (b[at + i] !== needle[i]) return false;
  return true;
};

/** Range reader that serves the head and (once loaded) the tail from memory. */
function source(size: number, fetch: Fetch) {
  let head: Uint8Array | null = null, tail: Uint8Array | null = null;
  const tailStart = Math.max(0, size - TAIL_BYTES);
  const read = async (start: number, end: number): Promise<Uint8Array> => {
    start = Math.max(0, start); end = Math.min(size, end);
    if (end <= start) return new Uint8Array(0);
    if (head && end <= head.length) return head.subarray(start, end);
    if (tail && start >= tailStart) return tail.subarray(start - tailStart, end - tailStart);
    return fetch(start, end);
  };
  return {
    size, read,
    head: async () => (head ??= await fetch(0, Math.min(size, HEAD_BYTES))),
    tail: async () => (tail ??= await fetch(tailStart, size)),
  };
}
type Source = ReturnType<typeof source>;

/** Size and type of the ISO-BMFF box at `at` within [at, limit), or null. */
async function box(src: Source, at: number, limit: number): Promise<{ type: string; size: number; header: number } | null> {
  if (at + 8 > limit) return null;
  const h = await src.read(at, Math.min(at + 16, limit));
  let size = u32(h, 0), header = 8;
  if (size === 1) {
    if (h.length < 16) return null;
    size = u32(h, 8) * 2 ** 32 + u32(h, 12); header = 16;
  } else if (size === 0) size = limit - at;
  return size >= header && at + size <= limit ? { type: text(h, 4, 4), size, header } : null;
}

/** End of an MP4 starting at `start` (ftyp first, moov required), or -1. */
async function mp4End(src: Source, start: number, limit: number): Promise<number> {
  let at = start, moov = false;
  for (let i = 0; i < MAX_BOXES && at < limit; i++) {
    const b = await box(src, at, limit);
    if (!b || !MP4_BOXES.has(b.type) || (i === 0 && b.type !== "ftyp")) break;
    moov ||= b.type === "moov";
    at += b.size;
  }
  return moov ? at : -1;
}

function jpegXmp(head: Uint8Array): string | null {
  for (let at = 2; at + 4 <= head.length;) {
    if (head[at] !== 0xff) return null;
    const marker = head[at + 1];
    if (marker === 0xff) { at++; continue; }
    if (marker === 0xda || marker === 0xd9) return null; // image data starts; XMP precedes it
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const end = at + 2 + u16(head, at + 2);
    if (end <= at + 2 || end > head.length) return null;
    if (marker === 0xe1 && startsWith(head, at + 4, XMP_NS)) return text(head, at + 4 + XMP_NS.length, end - at - 4 - XMP_NS.length);
    at = end;
  }
  return null;
}

const int = (value: string | undefined) => value && /^\d+$/.test(value) ? Number(value) : NaN;

/** Candidate ranges from the XMP; the MP4 is validated by the caller. */
function fromXmp(size: number, xmp: string): { stillEnd: number; videoStart: number } | null {
  const items = [...xmp.matchAll(/<Container:Item\b([^>]*?)\/?>/g)].map(([, attrs]) =>
    Object.fromEntries([...attrs.matchAll(/Item:(\w+)\s*=\s*["']([^"']*)["']/g)].map(([, k, v]) => [k, v])));
  let videoStart = NaN, stillEnd = NaN;
  if (/GCamera:MotionPhoto\s*=\s*["']1["']|<GCamera:MotionPhoto>\s*1\s*</.test(xmp)) {
    const motion = items.findIndex(item => item.Semantic === "MotionPhoto");
    // Only the spec layout: the video is the last item, so its length ends at EOF.
    if (motion < 0 || motion !== items.length - 1) return null;
    videoStart = size - int(items[motion].Length);
    const primary = int(items[0]?.Length);
    if (items[0]?.Semantic === "Primary" && primary > 0) stillEnd = primary;
  } else if (/GCamera:MicroVideo\s*=\s*["']1["']/.test(xmp)) {
    videoStart = size - int(/GCamera:MicroVideoOffset\s*=\s*["'](\d+)["']/.exec(xmp)?.[1]);
  } else return null;
  if (!Number.isInteger(videoStart) || videoStart <= 0 || videoStart >= size) return null;
  return { stillEnd: Number.isInteger(stillEnd) && stillEnd <= videoStart ? stillEnd : videoStart, videoStart };
}

/**
 * Samsung SEF trailer: ... records ... "SEFH" u32 version, u32 count, count x
 * (u16 pad, u16 type, u32 distance back from SEFH, u32 length), u32 SEFH size, "SEFT".
 * Each record is u16 pad, u16 type, u32 name length, name, data. Little-endian.
 */
async function fromSef(src: Source): Promise<{ stillEnd: number; videoStart: number } | null> {
  const tail = await src.tail(), tailStart = src.size - tail.length;
  if (tail.length < 8 || text(tail, tail.length - 4, 4) !== "SEFT") return null;
  const sefh = src.size - 8 - u32le(tail, tail.length - 8) - tailStart;
  if (sefh < 0 || text(tail, sefh, 4) !== "SEFH") return null;
  const count = u32le(tail, sefh + 8);
  if (count > MAX_SEF_ENTRIES || sefh + 12 + count * 12 > tail.length) return null;
  let first = Infinity, motion = -1;
  for (let i = 0; i < count; i++) {
    const entry = sefh + 12 + i * 12, record = tailStart + sefh - u32le(tail, entry + 4);
    if (record < 0) return null;
    first = Math.min(first, record);
    if (((tail[entry + 3] << 8) | tail[entry + 2]) === SEF_MOTION) motion = record;
  }
  if (motion < 0) return null;
  const header = await src.read(motion, motion + 8);
  if (header.length < 8 || u32le(header, 4) > 256) return null;
  return { stillEnd: first, videoStart: motion + 8 + u32le(header, 4) };
}

async function locateJpeg(src: Source, head: Uint8Array): Promise<MotionPhotoRanges | null> {
  const xmp = jpegXmp(head);
  const fromMeta = xmp ? fromXmp(src.size, xmp) : null;
  const sef = await fromSef(src);
  for (const candidate of [fromMeta, sef]) {
    if (!candidate) continue;
    const videoEnd = await mp4End(src, candidate.videoStart, src.size);
    if (videoEnd < 0) continue;
    // The SEF records sit between the JPEG and its MP4; trim them off the still.
    const stillEnd = sef && sef.videoStart === candidate.videoStart ? Math.min(candidate.stillEnd, sef.stillEnd) : candidate.stillEnd;
    return { stillEnd, videoStart: candidate.videoStart, videoEnd };
  }
  return null;
}

async function locateHeif(src: Source): Promise<MotionPhotoRanges | null> {
  for (let at = 0, i = 0; i < MAX_BOXES && at < src.size; i++) {
    const b = await box(src, at, src.size);
    if (!b) return null;
    if (b.type === "mpvd") {
      const videoStart = at + b.header, videoEnd = await mp4End(src, videoStart, at + b.size);
      return videoEnd < 0 ? null : { stillEnd: at, videoStart, videoEnd };
    }
    at += b.size;
  }
  return null;
}

async function locate(src: Source): Promise<MotionPhotoRanges | null> {
  try {
    if (src.size < 16) return null;
    const head = await src.head();
    if (head[0] === 0xff && head[1] === 0xd8) return await locateJpeg(src, head);
    return text(head, 4, 4) === "ftyp" ? await locateHeif(src) : null;
  } catch {
    return null;
  }
}

/** Byte ranges of the still and the embedded MP4, from an in-memory file. */
export function extractMotionPhotoVideo(bytes: Uint8Array): Promise<MotionPhotoRanges | null> {
  return locate(source(bytes.length, async (start, end) => bytes.subarray(start, end)));
}

/** Same, reading only small slices of the file. */
export function locateMotionPhotoVideo(file: Blob): Promise<MotionPhotoRanges | null> {
  return locate(source(file.size, async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer())));
}
