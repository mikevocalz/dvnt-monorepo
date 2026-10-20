import test from "node:test";
import assert from "node:assert/strict";
import { extractMotionPhotoVideo, locateMotionPhotoVideo } from "./motion-photo.ts";

// Layouts mirror immich-app/test-assets formats/motionphoto, checked with
// exiftool and ffprobe: Pixel (XMP directory, MP4 runs to EOF), Samsung JPEG
// (SEF records around the MP4, SEFH/SEFT index at EOF) and Samsung HEIC (`mpvd` box).
const bytes = (...parts: (string | number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap(p => typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : [...p]));
const u16 = (n: number) => [n >> 8, n & 255];
const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
const box = (type: string, ...payload: (string | number[] | Uint8Array)[]) => { const body = bytes(...payload); return bytes(u32(8 + body.length), type, body); };
const mp4 = () => bytes(box("ftyp", "isom", u32(0), "isom"), box("mdat", [1, 2, 3, 4, 5, 6]), box("moov", box("mvhd", u32(0))));
const xmpSegment = (xmp: string) => { const payload = bytes("http://ns.adobe.com/xap/1.0/\0", xmp); return bytes([0xff, 0xe1], u16(payload.length + 2), payload); };
const jpeg = (xmp?: string) => bytes([0xff, 0xd8], xmp ? xmpSegment(xmp) : [], [0xff, 0xda], u16(4), [9, 9], [0xff, 0xd9]);
const directory = (items: string[]) => `<x:xmpmeta><rdf:Description GCamera:MotionPhoto="1"><Container:Directory><rdf:Seq>${items.map(i => `<rdf:li><Container:Item ${i}/></rdf:li>`).join("")}</rdf:Seq></Container:Directory></rdf:Description></x:xmpmeta>`;
/** Samsung SEF records followed by their SEFH index and SEFT footer. */
function sef(records: [type: number, name: string, data: Uint8Array][]) {
  const encoded = records.map(([type, name, data]) => bytes([0, 0, type & 255, type >> 8], le32(name.length), name, data));
  const body = bytes(...encoded);
  let distance = body.length;
  const entries = encoded.map((record, i) => { const entry = bytes([0, 0, records[i][0] & 255, records[i][0] >> 8], le32(distance), le32(record.length)); distance -= record.length; return entry; });
  const index = bytes("SEFH", le32(107), le32(records.length), ...entries);
  return { body, trailer: bytes(index, le32(index.length), "SEFT"), motionOffset: body.length - encoded.at(-1)!.length + 8 + records.at(-1)![1].length };
}

test("Google Motion Photo: the last directory item's length locates the MP4 at the end of the file", async () => {
  const video = mp4(), gainMap = bytes([0xff, 0xd8, 7, 7, 0xff, 0xd9]);
  const still = jpeg(directory([`Item:Semantic="Primary" Item:Mime="image/jpeg"`, `Item:Semantic="GainMap" Item:Length="${gainMap.length}"`, `Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${video.length}" Item:Padding="0"`]));
  const file = bytes(still, gainMap, video);
  assert.deepEqual(await extractMotionPhotoVideo(file), { stillEnd: still.length + gainMap.length, videoStart: still.length + gainMap.length, videoEnd: file.length });
});

test("Samsung JPEG: XMP or the SEF index locates the MP4; SEF records and index are trimmed off both halves", async () => {
  const video = mp4();
  const { body, trailer, motionOffset } = sef([[0x0a01, "Image_UTC_Data", bytes("1705260000000")], [0x0a30, "MotionPhoto_Data", video]]);
  // Fixed-width digits keep the XMP the same size whatever the lengths are.
  const still = (primary: number) => jpeg(directory([`Item:Semantic="Primary" Item:Length="${String(primary).padStart(8, "0")}"`, `Item:Semantic="MotionPhoto" Item:Length="${String(video.length + trailer.length).padStart(8, "0")}"`]));
  const primary = still(0).length;
  const expected = { stillEnd: primary, videoStart: primary + motionOffset, videoEnd: primary + motionOffset + video.length };
  assert.deepEqual(await extractMotionPhotoVideo(bytes(still(primary), body, trailer)), expected);
  const plain = jpeg();
  assert.deepEqual(await extractMotionPhotoVideo(bytes(plain, body, trailer)), { stillEnd: plain.length, videoStart: plain.length + motionOffset, videoEnd: plain.length + motionOffset + video.length }, "SEF index alone");
});

test("legacy MicroVideo offset", async () => {
  const video = mp4(), legacy = jpeg(`<x:xmpmeta GCamera:MicroVideo="1" GCamera:MicroVideoOffset="${video.length}"/>`);
  assert.deepEqual(await extractMotionPhotoVideo(bytes(legacy, video)), { stillEnd: legacy.length, videoStart: legacy.length, videoEnd: legacy.length + video.length });
});

test("HEIC: the top-level mpvd box holds the MP4; the still ends where it starts", async () => {
  const head = bytes(box("ftyp", "heic", u32(0), "mif1heic"), box("mdat", [1, 2, 3]), box("meta", u32(0)));
  const mpvd = box("mpvd", mp4());
  const file = bytes(head, mpvd, box("sefd", "MotionPhoto_Data", "mpv2"));
  assert.deepEqual(await extractMotionPhotoVideo(file), { stillEnd: head.length, videoStart: head.length + 8, videoEnd: head.length + mpvd.length });
});

test("anything that is not a located ftyp+moov MP4 returns null without throwing", async () => {
  const video = mp4();
  const flagged = (length: number, tail: Uint8Array) => bytes(jpeg(directory([`Item:Semantic="Primary"`, `Item:Semantic="MotionPhoto" Item:Length="${length}"`])), tail);
  assert.equal(await extractMotionPhotoVideo(jpeg()), null, "plain JPEG");
  assert.equal(await extractMotionPhotoVideo(flagged(video.length + 3, video)), null, "length misses ftyp");
  assert.equal(await extractMotionPhotoVideo(flagged(10 ** 12, video)), null, "length beyond the file");
  assert.equal(await extractMotionPhotoVideo(flagged(12, bytes(box("ftyp", "isom")))), null, "ftyp without moov");
  const notMp4 = sef([[0x0a30, "MotionPhoto_Data", bytes("not an mp4 at all")]]);
  assert.equal(await extractMotionPhotoVideo(bytes(jpeg(), notMp4.body, notMp4.trailer)), null, "SEF record without MP4");
  assert.equal(await extractMotionPhotoVideo(bytes(jpeg(), "SEFH", le32(107), le32(10 ** 6), le32(20), "SEFT")), null, "absurd SEF count");
  assert.equal(await extractMotionPhotoVideo(bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])), null, "segment length past EOF");
  assert.equal(await extractMotionPhotoVideo(bytes(box("ftyp", "heic"), [0, 0, 0, 1], "mpvd", u32(0), u32(99))), null, "64-bit size past EOF");
  assert.equal(await extractMotionPhotoVideo(new Uint8Array(0)), null);
  for (let cut = 1; cut < video.length; cut += 5) assert.equal(await extractMotionPhotoVideo(flagged(video.length, video).subarray(0, -cut)), null);
});

/** Counts the bytes a Blob-backed lookup actually reads. */
function counted(parts: BlobPart[]) {
  const blob = new Blob(parts), reads: number[] = [];
  const view = { size: blob.size, slice: (start: number, end: number) => { reads.push(end - start); return blob.slice(start, end); } } as Blob;
  return { view, reads };
}

test("Blob lookups read small slices only: a plain photo costs two, a Motion Photo never reads its video", async () => {
  const plain = counted([jpeg(), new Uint8Array(4 * 1024 * 1024)]);
  assert.equal(await locateMotionPhotoVideo(plain.view), null);
  assert.deepEqual(plain.reads, [256 * 1024, 64 * 1024]);
  const big = bytes(box("ftyp", "isom", u32(0)), [0, 0, 0, 0], "mdat"), moov = box("moov", u32(0)), payload = 3 * 1024 * 1024;
  big.set(u32(8 + payload), big.length - 8);
  const still = jpeg(directory([`Item:Semantic="Primary"`, `Item:Semantic="MotionPhoto" Item:Length="${big.length + payload + moov.length}"`]));
  const motion = counted([still, new Uint8Array(512 * 1024), big, new Uint8Array(payload), moov]);
  const found = await locateMotionPhotoVideo(motion.view);
  assert.equal(found?.videoEnd, motion.view.size);
  assert.ok(motion.reads.reduce((a, b) => a + b) < 400 * 1024, `read ${motion.reads.join("+")} bytes of ${motion.view.size}`);
  const heic = counted([box("ftyp", "heic"), bytes(u32(8 + 2 * 1024 * 1024), "mdat"), new Uint8Array(2 * 1024 * 1024), box("meta", u32(0))]);
  assert.equal(await locateMotionPhotoVideo(heic.view), null);
  assert.equal(heic.reads[0], 256 * 1024); assert.ok(heic.reads.slice(1).every(n => n <= 16));
});
