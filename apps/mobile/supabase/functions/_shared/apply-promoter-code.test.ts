import { assertEquals } from "jsr:@std/assert@1";
import { escapeLikePattern, validateAndApplyPromoterCode } from "./apply-promoter-code.ts";

// Postgres ILIKE with the default escape character, enough to show which
// stored codes a pattern would match.
function ilikeMatches(stored: string, pattern: string): boolean {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") re += ".*";
    else if (ch === "_") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i").test(stored);
}

Deno.test("escapeLikePattern escapes the LIKE metacharacters", () => {
  assertEquals(escapeLikePattern("TRE_1"), "TRE\\_1");
  assertEquals(escapeLikePattern("50%OFF"), "50\\%OFF");
  assertEquals(escapeLikePattern("A\\B"), "A\\\\B");
  assertEquals(escapeLikePattern("TRE151SHARE"), "TRE151SHARE");
});

Deno.test("a code with _ matches only itself, case-insensitively", async () => {
  const rows = [
    { id: 1, code: "TREX1", customer_discount_bps: 1000, promoter_commission_bps: 500, status: "active" },
    { id: 2, code: "Tre_1", customer_discount_bps: 2000, promoter_commission_bps: 500, status: "active" },
  ];
  let pattern = "";
  const supabase = {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        ilike: (_col: string, p: string) => {
          pattern = p;
          return q;
        },
        maybeSingle: () => {
          const hits = rows.filter((r) => ilikeMatches(r.code, pattern));
          return Promise.resolve(
            hits.length > 1
              ? { data: null, error: { message: "multiple rows" } }
              : { data: hits[0] ?? null, error: null },
          );
        },
      };
      return q;
    },
  };

  const { result, error } = await validateAndApplyPromoterCode(supabase, 7, "tre_1", 10_000, 1);
  assertEquals(error, null);
  assertEquals(result !== null, true);
  assertEquals(ilikeMatches("TREX1", pattern), false);
  assertEquals(ilikeMatches("Tre_1", pattern), true);
});
