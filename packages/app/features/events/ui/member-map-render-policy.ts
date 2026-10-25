/** A map never turns an expired or malformed response into a visible person. */
export interface MapMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  latitude: number;
  longitude: number;
  expiresAt: string;
}
export function visibleMapMembers(members: readonly MapMember[], now: number): MapMember[] {
  return members.filter((member) => Boolean(member.id && member.username) &&
    Number.isFinite(member.latitude) && Math.abs(member.latitude) <= 90 &&
    Number.isFinite(member.longitude) && Math.abs(member.longitude) <= 180 &&
    Number.isFinite(Date.parse(member.expiresAt)) && Date.parse(member.expiresAt) > now);
}
export function mapMemberInitials(member: Pick<MapMember, 'displayName' | 'username'>): string {
  const name = member.displayName?.trim() || member.username;
  return name.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0] || '').join('').toUpperCase();
}
export function mapMemberProfilePath(username: string, native = false): string {
  return `${native ? '/(protected)' : ''}/profile/${encodeURIComponent(username)}`;
}
/** Avatar sources are profile media only, not script/data URLs. */
export function mapAvatarUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}
