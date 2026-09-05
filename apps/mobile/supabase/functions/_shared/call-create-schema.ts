import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

export const CallCreateSchema = z.object({
  title: z.string().min(1).max(100),
  participantIds: z.array(
    z.string().regex(/^[1-9]\d*$/).refine(
      (id) => Number.isSafeInteger(Number(id)),
      "Invalid participant ID",
    ),
  ).min(1).max(3),
  hasVideo: z.boolean().default(true),
  // Released phone builds send 10; the hint never changes call capacity.
  maxParticipants: z.number().int().min(2).max(50).optional().transform(() =>
    4
  ),
});
