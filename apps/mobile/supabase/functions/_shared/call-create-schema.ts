import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  CALL_HUMAN_CAPACITY,
  CALL_MAX_INVITEES,
} from "./call-capacity.ts";

export const CallCreateSchema = z.object({
  title: z.string().min(1).max(100),
  participantIds: z.array(
    z.string().regex(/^[1-9]\d*$/).refine(
      (id) => Number.isSafeInteger(Number(id)),
      "Invalid participant ID",
    ),
  ).min(1).max(CALL_MAX_INVITEES),
  hasVideo: z.boolean().default(true),
  // The group chat this call belongs to — lets the chat header offer a
  // Join/Rejoin button while the room is open. Optional: direct calls and
  // older clients omit it.
  chatId: z.string().regex(/^[1-9]\d*$/).optional(),
  // Released phone builds send legacy hints; the hint never changes call capacity.
  // Calls seat the caller plus up to CALL_MAX_INVITEES invitees
  // (CALL_HUMAN_CAPACITY total), the cap every layer below agrees on:
  // admit_call_participant, call-media maxPeers, and the client validator.
  maxParticipants: z.number().int().min(2).max(50).optional().transform(() =>
    CALL_HUMAN_CAPACITY
  ),
});
