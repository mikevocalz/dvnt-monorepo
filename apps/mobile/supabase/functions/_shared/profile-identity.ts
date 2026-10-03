// Which users identity columns an update-profile request may write.
//
// A key the request leaves out is never written. A form whose prefill read
// failed used to send gender "", sexuality [] and eventAudience "" anyway, and
// that overwrote what the member had stored. So "" and [] are now treated as
// "not filled in" and skipped; clearing a value takes an explicit null.

export interface IdentityUpdate {
  gender?: string | null;
  sexuality?: string[] | null;
  eventAudience?: string | null;
}

export function identityColumns(updates: IdentityUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (updates.gender === null) out.gender = null;
  else if (typeof updates.gender === "string" && updates.gender.trim() !== "") {
    out.gender = updates.gender.trim();
  }
  if (updates.sexuality === null) out.sexuality = null;
  else if (Array.isArray(updates.sexuality) && updates.sexuality.length > 0) {
    out.sexuality = updates.sexuality;
  }
  if (updates.eventAudience === null) out.event_audience = null;
  else if (typeof updates.eventAudience === "string" && updates.eventAudience.trim() !== "") {
    out.event_audience = updates.eventAudience.trim();
  }
  return out;
}
