"use client";
import { getGoogleMapsPublicKey } from "@dvnt/ui/google-maps-public-config";

import { useEffect, useState } from "react";
import { APIProvider, Map, Marker, useApiLoadingStatus, APILoadingStatus, useMapsLibrary } from "@vis.gl/react-google-maps";
import { useRouter } from "solito/navigation";
import { LocationControls } from "@dvnt/app/features/settings/ui/LocationControls";
import { useLocationSettings, useMemberMapPresence, useNearbyMembers } from "@dvnt/app/lib/hooks/use-member-map";
import { mapAvatarUrl, mapMemberInitials, mapMemberProfilePath, visibleMapMembers, type MapMember } from "./member-map-render-policy";

export default function MemberMap() {
  const key = getGoogleMapsPublicKey();
  if (!key) return (
    <section aria-label="Nearby people" className="p-4 space-y-4">
      <p role="status">The nearby people map is not available on this website yet. Event venues still work. No location is collected here.</p>
      <LocationControls allowSharing={false} />
    </section>
  );
  return <APIProvider apiKey={key}><MemberMapContent /></APIProvider>;
}

function MemberMapContent() {
  const status = useApiLoadingStatus();
  const ready = status === APILoadingStatus.LOADED;
  const { sharing } = useLocationSettings();
  const presence = useMemberMapPresence(ready);
  const nearby = useNearbyMembers(ready);
  const [now, setNow] = useState(Date.now);
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Fail closed on opt-out, expired viewer lease or any refresh error. Server
  // also enforces consent/blocking; polling is never authority to retain pins.
  const leaseLive = nearby.data?.expiresAt && Date.parse(nearby.data.expiresAt) > now;
  const members = sharing && !nearby.isError && leaseLive
    ? visibleMapMembers(nearby.data?.members || [], now) : [];
  const center = sharing && !nearby.isError && leaseLive ? nearby.data?.center : null;
  const open = (member: MapMember) => router.push(mapMemberProfilePath(member.username));
  const failed = status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE;

  return (
    <section aria-label="Nearby people" className="p-4 space-y-4">
      <p className="text-sm text-white/65">Avatars show an approximate area, not an exact location or event attendance. Only members who choose to share appear.</p>
      <LocationControls allowSharing={ready} />
      {!ready ? <p role={failed ? 'alert' : 'status'}>{failed ? 'Google Maps could not load. Sharing cannot be enabled here. You can still turn existing sharing off above.' : 'Loading nearby map…'}</p> : null}
      {ready && sharing ? <button type="button" disabled={presence.isUpdating} className="min-h-11 rounded-xl bg-[#379ED8] text-black px-4 font-semibold disabled:opacity-50" onClick={() => void presence.refresh()}>Update my location</button> : null}
      {presence.error ? <p role="alert">{presence.error}</p> : null}
      {nearby.isError ? (
        <div role="alert"><p>Nearby people could not be refreshed. Locations have been hidden.</p><button className="min-h-11 px-4 rounded-xl bg-white/10" onClick={() => void nearby.refetch()}>Retry nearby people</button></div>
      ) : null}
      {ready && sharing && !center && !nearby.isError ? <p role="status">{presence.isUpdating || nearby.isPending ? 'Updating your approximate location…' : 'A fresh location is needed to show nearby people.'}</p> : null}
      {ready && center ? (
        <>
          <div className="h-[360px] sm:h-[440px] overflow-hidden rounded-xl" aria-label="Approximate nearby member locations">
            <Map defaultCenter={{ lat: center.latitude, lng: center.longitude }} defaultZoom={12} gestureHandling="cooperative" disableDefaultUI={false}>
              {members.map((member) => <AvatarMarker key={member.id} member={member} onClick={() => open(member)} />)}
            </Map>
          </div>
          <p role="status" className="text-sm text-white/60">{members.length ? `${members.length} nearby ${members.length === 1 ? 'member' : 'members'} sharing an approximate area` : 'No nearby members are sharing right now.'}</p>
          <ul aria-label="Nearby members" className="grid sm:grid-cols-2 gap-2">
            {members.map((member) => (
              <li key={member.id} className="min-w-0"><button className="w-full min-h-14 rounded-xl border border-white/15 p-3 flex items-center gap-3 text-left" onClick={() => open(member)}><Avatar member={member} /><span className="min-w-0 break-words"><span className="block font-semibold">{member.displayName || member.username}</span><span className="block text-sm text-white/60">@{member.username} · approximate area</span></span></button></li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Avatar({ member }: { member: MapMember }) {
  const [failed, setFailed] = useState(false);
  const src = mapAvatarUrl(member.avatarUrl);
  return src && !failed
    ? <img src={src} alt="" referrerPolicy="no-referrer" className="w-11 h-11 shrink-0 rounded-full object-cover" onError={() => setFailed(true)} />
    : <span aria-hidden="true" className="w-11 h-11 shrink-0 rounded-full bg-[#8A40CF] flex items-center justify-center font-bold">{mapMemberInitials(member)}</span>;
}

function AvatarMarker({ member, onClick }: { member: MapMember; onClick: () => void }) {
  // Marker image URL contains no coordinates. The only position supplied to
  // Google is the server's coarse grid cell, never the device GPS sample.
  const avatar = mapAvatarUrl(member.avatarUrl);
  const core = useMapsLibrary("core");
  const [loadedAvatar, setLoadedAvatar] = useState<string | null>(null);
  useEffect(() => {
    setLoadedAvatar(null);
    if (!avatar) return;
    let current = true;
    const image = new window.Image();
    image.referrerPolicy = "no-referrer";
    image.onload = () => { if (current) setLoadedAvatar(avatar); };
    image.onerror = () => { if (current) setLoadedAvatar(null); };
    image.src = avatar;
    return () => { current = false; image.onload = null; image.onerror = null; };
  }, [avatar]);
  return <Marker
    position={{ lat: member.latitude, lng: member.longitude }}
    title={`${member.displayName || member.username} — approximate area`}
    label={loadedAvatar === avatar && avatar ? undefined : { text: mapMemberInitials(member), color: '#ffffff' }}
    icon={loadedAvatar === avatar && avatar && core ? { url: avatar, scaledSize: new core.Size(44, 44) } : undefined}
    onClick={onClick}
  />;
}
