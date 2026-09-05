import { CallCreateSchema } from "./call-create-schema.ts";

Deno.test("calls accept one to three invitees and default to four total", () => {
  for (const participantIds of [["1"], ["1", "2"], ["1", "2", "3"]]) {
    const parsed = CallCreateSchema.parse({ title: "Crew", participantIds });
    if (parsed.maxParticipants !== 4) {
      throw new Error("Call capacity must default to four");
    }
  }
});

Deno.test("calls reject empty and oversized recipient sets", () => {
  for (const participantIds of [[], ["1", "2", "3", "4"]]) {
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

Deno.test("legacy participant hints normalize to four without breaking released phone clients", () => {
  for (const maxParticipants of [2, 3, 4, 5, 10, 50]) {
    const parsed = CallCreateSchema.parse({
      title: "Crew",
      participantIds: ["1"],
      maxParticipants,
    });
    if (parsed.maxParticipants !== 4) {
      throw new Error("Legacy hint changed call capacity");
    }
  }
});
