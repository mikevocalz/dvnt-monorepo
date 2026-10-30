import type { MapMember } from "./member-map-render-policy";

export type MapMemberCluster = { id: string; latitude: number; longitude: number; members: MapMember[] };

/** Screen-space grouping only: never alters the authorized coarse member coordinates. */
export function clusterMapMembers(members: MapMember[], zoom: number): MapMemberCluster[] {
  const scale = 256 * 2 ** Math.max(0, Math.min(22, Number.isFinite(zoom) ? zoom : 12));
  const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
  const points = sorted.map(member => {
    const sin = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, member.latitude)) * Math.PI / 180);
    return { x: (member.longitude + 180) / 360 * scale, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale };
  });
  const parents = sorted.map((_, i) => i);
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]));
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const dx = Math.abs(points[i].x - points[j].x);
    if (Math.hypot(Math.min(dx, scale - dx), points[i].y - points[j].y) <= 128) parents[root(j)] = root(i);
  }
  const groups = new Map<number, MapMember[]>();
  sorted.forEach((member, i) => { const key = root(i); groups.set(key, [...(groups.get(key) || []), member]); });
  return [...groups.values()].map(group => ({
    id: `${group.length === 1 ? 'member' : 'cluster'}:${group.map(member => member.id).join(':')}`,
    // Anchor to a real coarse coordinate rather than inventing a spread or increasing precision.
    latitude: group[0].latitude, longitude: group[0].longitude, members: group,
  }));
}
