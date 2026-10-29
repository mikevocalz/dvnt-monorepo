"use client";
import { getGoogleMapsPublicKey } from "@dvnt/ui/google-maps-public-config";

import { useEffect, useState } from "react";
import { APIProvider, Map, useApiLoadingStatus, APILoadingStatus, useMap } from "@vis.gl/react-google-maps";
import { RoundedMapMarker } from "./rounded-map-marker.web";
import { useRouter } from "solito/navigation";
import { LocationControls } from "@dvnt/app/features/settings/ui/LocationControls";
import { useLocationSettings, useMemberMapPresence, useNearbyMembers } from "@dvnt/app/lib/hooks/use-member-map";
import { mapAvatarUrl, mapMemberInitials, mapMemberProfilePath, visibleMapMembers, type MapMember } from "./member-map-render-policy";

import type { EventMapPin } from "@dvnt/app/lib/events/event-map";

type UnifiedMapProps = { eventPins?: EventMapPin[]; selectedEventId?: string | null; onSelectEvent?: (id: string | null) => void; onOpenEvent?: (id: string) => void };
export default function MemberMap(props: UnifiedMapProps = {}) {
  const key = getGoogleMapsPublicKey();
  if (!key) return (
    <section aria-label="Events and people map" className="p-4 space-y-4">
      <p role="status">The map is unavailable on this device. Event details remain available in the list. No location is collected here.</p>
      <LocationControls allowSharing={false} />
    </section>
  );
  return <APIProvider apiKey={key}><MemberMapContent {...props} /></APIProvider>;
}

function MemberMapContent({ eventPins = [], selectedEventId, onSelectEvent, onOpenEvent }: UnifiedMapProps) {
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
    ? visibleMapMembers([...(nearby.data?.self ? [nearby.data.self] : []), ...(nearby.data?.members || [])], now) : [];
  const center = sharing && !nearby.isError && leaseLive ? nearby.data?.center : null;
  const selectedEvent = eventPins.find(pin => pin.id === selectedEventId);
  const ownArea = presence.area || center;
  const mapCenter = selectedEvent || ownArea || { latitude: 39.5, longitude: -98.35 };
  const mapZoom = selectedEvent || ownArea ? 12 : 3;
  const open = (member: MapMember) => router.push(mapMemberProfilePath(member.username));
  const failed = status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE;

  return (
    <section aria-label="Events and people map" className="p-4 space-y-4">
      <p className="text-sm text-white/65">Avatars show an approximate area, not an exact location or event attendance. Only members who choose to share appear.</p>
      <LocationControls allowSharing={ready} />
      {!ready ? <p role={failed ? 'alert' : 'status'}>{failed ? 'Google Maps could not load. Sharing cannot be enabled here. You can still turn existing sharing off above.' : 'Loading nearby map…'}</p> : null}
      {presence.error ? <p role="alert">{presence.error}</p> : null}
      {nearby.isError ? (
        <div role="alert"><p>Nearby people could not be refreshed. Locations have been hidden.</p><button className="min-h-11 px-4 rounded-xl bg-white/10" onClick={() => void nearby.refetch()}>Retry nearby people</button></div>
      ) : null}
      {ready && sharing && !center && !nearby.isError ? <p role="status">{presence.isUpdating || nearby.isPending ? 'Updating your approximate location…' : 'A fresh location is needed to show nearby people.'}</p> : null}
      {ready && !ownArea ? <p role="status">Showing public event locations, not events near you. Your location has not been established on this map.</p> : null}
      {ready ? (
        <>
          <div className="h-[360px] sm:h-[440px] overflow-hidden rounded-xl" aria-label="Event flyers and approximate member locations">
            <Map defaultCenter={{ lat: mapCenter.latitude, lng: mapCenter.longitude }} defaultZoom={mapZoom} gestureHandling="cooperative" disableDefaultUI={false}>
              <MapFocus latitude={mapCenter.latitude} longitude={mapCenter.longitude} zoom={mapZoom} revision={selectedEvent?.id || presence.area?.expiresAt || nearby.data?.expiresAt || "overview"} />
              {eventPins.map(pin => <EventFlyerMarker key={`event:${pin.id}`} pin={pin} onClick={() => { onSelectEvent?.(pin.id); onOpenEvent?.(pin.id); }} />)}
              {members.map((member) => <AvatarMarker key={`member:${member.id}`} member={member} self={member.id === nearby.data?.self?.id} onClick={() => open(member)} />)}
            </Map>
          </div>
          <p role="status" className="text-sm text-white/60">{members.length ? `${members.length} ${members.length === 1 ? 'avatar' : 'avatars'} sharing an approximate area` : sharing ? 'Your avatar will appear when a fresh permitted location is available.' : 'Turn on avatar sharing to show yourself and nearby members.'}</p>
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
    ? <img src={src} alt="" referrerPolicy="no-referrer" className="w-11 h-11 shrink-0 rounded-sm object-cover" onError={() => setFailed(true)} />
    : <span aria-hidden="true" className="w-11 h-11 shrink-0 rounded-sm bg-[#8A40CF] flex items-center justify-center font-bold">{mapMemberInitials(member)}</span>;
}

function AvatarMarker({ member, onClick, self = false }: { member: MapMember; onClick: () => void; self?: boolean }) {
  return <RoundedMapMarker latitude={member.latitude} longitude={member.longitude}
    title={`${self ? "You" : member.displayName || member.username} — approximate area`}
    source={mapAvatarUrl(member.avatarUrl)} fallback={mapMemberInitials(member)}
    onClick={onClick} />;
}

/** Follow an explicit event selection or a newly published coarse area, not the expiry clock. */
function MapFocus({ latitude, longitude, zoom, revision }: { latitude: number; longitude: number; zoom: number; revision: string }) {
  const map = useMap();
  useEffect(() => { map?.panTo({ lat: latitude, lng: longitude }); map?.setZoom(zoom); }, [map, latitude, longitude, zoom, revision]);
  return null;
}

function EventFlyerMarker({ pin, onClick }: { pin: EventMapPin; onClick: () => void }) {
  return <RoundedMapMarker latitude={pin.latitude} longitude={pin.longitude}
    title={`Event: ${pin.title}`} source={mapAvatarUrl(pin.flyerUrl)}
    fallback="EVENT" height={60} onClick={onClick} />;
}
