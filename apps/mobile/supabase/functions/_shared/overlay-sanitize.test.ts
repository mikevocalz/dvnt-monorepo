import { assertEquals } from "jsr:@std/assert";
import { cleanMetadata, str } from "./overlay-sanitize.ts";

Deno.test("str keeps a bounded string and drops everything else", () => {
  assertEquals(str("event"), "event");
  assertEquals(str(""), undefined);
  assertEquals(str(42), undefined);
  assertEquals(str(null), undefined);
  assertEquals(str({}), undefined);
  assertEquals(str("x".repeat(300))?.length, 256);
});

Deno.test("cleanMetadata keeps a flat string map", () => {
  assertEquals(cleanMetadata({ eventId: "7", href: "https://dvnt.app" }), {
    eventId: "7",
    href: "https://dvnt.app",
  });
});

Deno.test("cleanMetadata drops non-string values rather than stringifying them", () => {
  assertEquals(cleanMetadata({ ok: "1", n: 2, nested: { a: "b" } }), {
    ok: "1",
  });
});

Deno.test("cleanMetadata refuses anything that is not a plain object", () => {
  for (const bad of [null, undefined, "str", 7, [1, 2], [{ a: "b" }]]) {
    assertEquals(cleanMetadata(bad), undefined, JSON.stringify(bad) ?? "undef");
  }
});

Deno.test("cleanMetadata caps the key count", () => {
  const wide = Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`k${i}`, "v"]),
  );
  assertEquals(Object.keys(cleanMetadata(wide) ?? {}).length, 16);
});

Deno.test("an empty result is undefined, so no {} lands in the column", () => {
  assertEquals(cleanMetadata({}), undefined);
  assertEquals(cleanMetadata({ a: 1, b: null }), undefined);
});
