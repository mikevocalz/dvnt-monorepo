import test from "node:test";
import assert from "node:assert/strict";
import { motionContentId, stillContentId } from "./apple-content-id.ts";

// Layouts mirror real iPhone files (checked against exiftool on three osxphotos
// test pairs): a big-endian Apple MakerNote, and a QuickTime meta keys/ilst pair.
const ID = "DC121C25-1A7C-4FEC-BB42-99FB89A4719D";
const bytes = (...parts: (string | number[])[]) => Uint8Array.from(parts.flatMap(p => typeof p === "string" ? [...p].map(c => c.charCodeAt(0)) : p));
const u16 = (n: number) => [n >> 8, n & 255];
const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];

function makerNote(tag = 0x0011, id = ID) {
  const value = id + "\0";
  const valueOffset = 16 + 12 + 4; // header, one entry, next-IFD pointer
  return bytes("junkExif", "Apple iOS\0", u16(1), "MM", u16(1), u16(tag), u16(2), u32(value.length), u32(valueOffset), u32(0), value);
}

function quicktime(key = "com.apple.quicktime.content.identifier", id = ID) {
  const keyEntry = bytes(u32(8 + key.length), "mdta", key);
  const keys = bytes(u32(16 + keyEntry.length), "keys", u32(0), u32(1), [...keyEntry]);
  const data = bytes(u32(16 + id.length), "data", u32(1), u32(0), id);
  const item = bytes(u32(8 + data.length), u32(1), [...data]);
  const ilst = bytes(u32(8 + item.length), "ilst", [...item]);
  return bytes(u32(8), "ftyp", u32(0), "moov", [...keys], [...ilst]);
}

test("reads the content identifier from an Apple MakerNote and a QuickTime keys/ilst atom", () => {
  assert.equal(stillContentId(makerNote()), ID);
  assert.equal(motionContentId(quicktime()), ID);
});

test("returns null for files without the identifier, other tags, or malformed values", () => {
  assert.equal(stillContentId(bytes("plain jpeg bytes")), null);
  assert.equal(stillContentId(makerNote(0x0008)), null);
  assert.equal(stillContentId(makerNote(0x0011, "not-a-uuid")), null);
  assert.equal(motionContentId(quicktime("com.apple.quicktime.make")), null);
  assert.equal(motionContentId(bytes("ftypqt  keys")), null);
});
