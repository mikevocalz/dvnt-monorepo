import test from "node:test";
import assert from "node:assert/strict";
import { appendLegacyCaptionTags, getCaptionMetrics, parseCaptionHashtags, validatePostCaption, MAX_CAPTION_LENGTH, MAX_CAPTION_RAW_LENGTH } from "./post-caption.ts";
import { parseCaptionParts } from "./caption-parts.ts";
import { validateCaption } from "../utils/validation-guards.ts";

for (const caption of ["", "Plain caption", "Hello #music", "#東京 #café #cafe\u0301 #नमस्ते #العربية", "#one, (#two)! 😀#three", "One\n#tag\nTwo"]) {
  test(`caption token offsets reconstruct the exact original: ${JSON.stringify(caption)}`, () => {
    const parts = parseCaptionParts(caption);
    assert.equal(parts.map((part) => part.content).join(""), caption);
    for (const token of parseCaptionHashtags(caption)) assert.equal(caption.slice(token.start, token.end), token.text);
  });
}
test("existing 2200-character budget excludes inline hashtags and trailing tag whitespace", () => {
  const caption = `${"x".repeat(MAX_CAPTION_LENGTH)}\n#東京 #café`;
  assert.equal(getCaptionMetrics(caption).characterCount, 2200);
  assert.equal(validateCaption(caption).valid, true);
  assert.equal(validatePostCaption(`x${caption}`).valid, false);
  assert.equal(getCaptionMetrics("one #tag two").characterCount, 8, "interior prose spaces still count");
  assert.equal(getCaptionMetrics("#tag, hello!").characterCount, 8, "punctuation is prose");
});
test("hashtags support Unicode and NFC case-insensitive dedup without changing original text", () => {
  const caption = "#Café #cafe\u0301 #CAFÉ #東京 #नमस्ते #مرحبا #party_2";
  assert.deepEqual(getCaptionMetrics(caption).hashtags, ["café", "東京", "नमस्ते", "مرحبا", "party_2"]);
  assert.equal(getCaptionMetrics(caption).tokens.length, 7);
  assert.equal(parseCaptionParts("#cafe\u0301")[0].value, "cafe\u0301", "raw search spelling survives");
});
test("punctuation, URL fragments, email and malformed hashes never get free characters", () => {
  const caption = "https://test.example/#fragment mail#tag@example.com foo#bar ##double # #💜 #tag-name";
  assert.deepEqual(parseCaptionHashtags(caption).map((x) => x.text), ["#tag"]);
  assert.equal(getCaptionMetrics(caption).characterCount, caption.length - 4);
  assert.deepEqual(parseCaptionHashtags("#one,#two;#three").map((x) => x.tag), ["one", "two", "three"]);
});
test("raw payload, hashtag occurrences and tag sizes are independently bounded", () => {
  for (const input of [" ".repeat(MAX_CAPTION_RAW_LENGTH + 1), Array(31).fill("#same").join(" "), `#${"x".repeat(101)}`, null, 12, {}, []]) assert.equal(validatePostCaption(input).valid, false);
  assert.equal(validatePostCaption(Array(30).fill("#same").join(" ")).valid, true);
  assert.equal(validatePostCaption(`#${"x".repeat(100)}`).valid, true);
  assert.equal(validatePostCaption(undefined).valid, true);
});
test("emoji keep the established UTF-16 budget", () => {
  assert.equal(getCaptionMetrics("😀 #東京").characterCount, 2);
  assert.equal(validatePostCaption(`${"😀".repeat(1100)} #東京`).valid, true);
  assert.equal(validatePostCaption(`${"😀".repeat(1101)} #東京`).valid, false);
});
test("legacy separately saved tags append once without stripping, reordering or changing inline text", () => {
  const caption = "Music #Café, all night!";
  const combined = appendLegacyCaptionTags(caption, ["cafe\u0301", "CAFÉ", "東京", "#東京", "party_2"]);
  assert.equal(combined, `${caption}\n#東京 #party_2`);
  assert.equal(appendLegacyCaptionTags(combined, ["東京", "PARTY_2"]), combined);
  assert.equal(appendLegacyCaptionTags("", ["party"]), "#party");
  assert.equal(appendLegacyCaptionTags("hello\n", ["party"]), "hello\n#party");
});
test("clickable parts preserve existing mentions and exact hashtag search spelling", () => {
  const parts = parseCaptionParts("Hi @friend, #cafe\u0301! https://test/#skip");
  assert.deepEqual(parts.filter((p) => p.type !== "text").map((p) => [p.type, p.value]), [["mention", "friend"], ["hashtag", "cafe\u0301"]]);
});

for (const caption of ["https://example.com/?q=#fragment", "https://example.com/foo.#section", "foo+#mail@example.com", "www.example.com?q=#fragment", "example.com/?q=#fragment"]) {
  test(`URL/email hashes stay literal: ${caption}`, () => {
    assert.deepEqual(parseCaptionHashtags(caption), []);
    assert.equal(getCaptionMetrics(caption).characterCount, caption.length);
    assert.deepEqual(parseCaptionHashtags(`${caption} #real`).map((token) => token.tag), ["real"]);
  });
}

test("punctuation-separated mentions do not turn a hashtag into an email", () => {
  assert.deepEqual(parseCaptionHashtags("#party,@friend").map(token => token.tag), ["party"]);
});
