import { CallCreateSchema } from "./call-create-schema.ts";
import { CALL_HUMAN_CAPACITY, CALL_MAX_INVITEES } from "./call-capacity.ts";

Deno.test("calls accept one to eleven invitees and default to twelve total", () => {
  for (const count of [1, 2, 4, 9, CALL_MAX_INVITEES]) {
    const participantIds = Array.from({ length: count }, (_, i) => String(i + 1));
    const parsed = CallCreateSchema.parse({ title: "Crew", participantIds });
    if (parsed.maxParticipants !== CALL_HUMAN_CAPACITY) {
      throw new Error("Call capacity must default to twelve");
    }
  }
});

Deno.test("calls reject empty and oversized recipient sets", () => {
  for (
    const participantIds of [[], Array.from(
      { length: CALL_HUMAN_CAPACITY },
      (_, i) => String(i + 1),
    )]
  ) {
    if (CallCreateSchema.safeParse({ title: "Crew", participantIds }).success) {
      throw new Error("Invalid recipient count accepted");
    }
  }
});

Deno.test("calls reject invalid IDs and capacity escalation", () => {
  for (
    const id of [
      "",
      "0",
      "-1",
      "1.5",
      "1e2",
      " 1",
      "9007199254740993",
      "auth-id",
    ]
  ) {
    if (
      CallCreateSchema.safeParse({ title: "Crew", participantIds: [id] })
        .success
    ) {
      throw new Error(`Invalid participant ID accepted: ${id}`);
    }
  }
  for (const maxParticipants of [0, 1, 4.5, 51]) {
    if (
      CallCreateSchema.safeParse({
        title: "Crew",
        participantIds: ["1"],
        maxParticipants,
      }).success
    ) {
      throw new Error(`Invalid call capacity accepted: ${maxParticipants}`);
    }
  }
});

Deno.test("legacy participant hints normalize to twelve without breaking released phone clients", () => {
  for (const maxParticipants of [2, 3, 4, 5, 10, 50]) {
    const parsed = CallCreateSchema.parse({
      title: "Crew",
      participantIds: ["1"],
      maxParticipants,
    });
    if (parsed.maxParticipants !== CALL_HUMAN_CAPACITY) {
      throw new Error("Legacy hint changed call capacity");
    }
  }
});

Deno.test("chatId links a call to its conversation and rejects junk", () => {
  const linked = CallCreateSchema.parse({
    title: "Crew",
    participantIds: ["1"],
    chatId: "116",
  });
  if (linked.chatId !== "116") {
    throw new Error("chatId not carried through");
  }
  const unlinked = CallCreateSchema.parse({
    title: "Crew",
    participantIds: ["1"],
  });
  if (unlinked.chatId !== undefined) {
    throw new Error("chatId must stay optional for direct calls");
  }
  for (const chatId of ["0", "-1", "1.5", "abc", " 1", "1 "]) {
    if (
      CallCreateSchema.safeParse({
        title: "Crew",
        participantIds: ["1"],
        chatId,
      }).success
    ) {
      throw new Error(`Invalid chatId accepted: ${chatId}`);
    }
  }
});
