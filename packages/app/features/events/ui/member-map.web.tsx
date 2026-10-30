"use client";
import { getGoogleMapsPublicKey } from "@dvnt/ui/google-maps-public-config";

import { useEffect, useState, useRef } from "react";
import { APIProvider, Map, useApiLoadingStatus, APILoadingStatus, useMap } from "@vis.gl/react-google-maps";
import { clusterMapMembers } from "./member-map-clusters";
import { RoundedMapMarker } from "./rounded-map-marker.web";
import { useRouter } from "solito/navigation";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { savedMapArea } from "./member-map-area";
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
  const savedCity = useEventsLocationStore((state) => state.activeCity);
  const savedArea = savedMapArea(savedCity);
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
  const mapCenter = selectedEvent || ownArea || savedArea || { latitude: 39.5, longitude: -98.35 };
  const mapZoom = selectedEvent || ownArea ? 12 : savedArea ? 8 : 3;
  const open = (member: MapMember) => router.push(mapMemberProfilePath(member.username));
  const failed = status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE;

  return (
    <section aria-label="Events and people map" className="p-4 space-y-4">
      {!ready ? <p role={failed ? 'alert' : 'status'}>{failed ? 'Google Maps could not load. Sharing cannot be enabled here. You can still turn existing sharing off below.' : 'Loading nearby map…'}</p> : null}
      {presence.error ? <p role="alert">{presence.error}</p> : null}
      {nearby.isError ? (
        <div role="alert"><p>Nearby people could not be refreshed. Locations have been hidden.</p><button className="min-h-11 px-4 rounded-xl bg-white/10" onClick={() => void nearby.refetch()}>Retry nearby people</button></div>
      ) : null}
      {ready && sharing && !center && !nearby.isError ? <p role="status">{presence.isUpdating || nearby.isPending ? 'Updating your approximate location…' : 'A fresh location is needed to show nearby people.'}</p> : null}
      {ready && !ownArea ? <p role="status">{savedArea ? `Showing your saved area: ${savedArea.label}. This is not a current device location.` : 'Showing public event locations, not events near you. Your location has not been established on this map.'}</p> : null}
      {!ready ? <LocationControls allowSharing={false} /> : null}
      {ready ? (
        <>
          <div className="relative h-[360px] sm:h-[440px] overflow-hidden rounded-xl" aria-label="Event flyers and approximate member locations">
            <Map defaultCenter={{ lat: mapCenter.latitude, lng: mapCenter.longitude }} defaultZoom={mapZoom} gestureHandling="cooperative" disableDefaultUI={false}>
              <MapFocus latitude={mapCenter.latitude} longitude={mapCenter.longitude} zoom={mapZoom} revision={selectedEvent?.id || presence.area?.expiresAt || nearby.data?.expiresAt || "overview"} />
              {eventPins.map(pin => <EventFlyerMarker key={`event:${pin.id}`} pin={pin} onClick={() => { onSelectEvent?.(pin.id); onOpenEvent?.(pin.id); }} />)}
              <ClusteredMembers members={members} selfId={nearby.data?.self?.id} initialZoom={mapZoom} onOpen={open} />
            </Map>
          </div>
          <p className="text-sm text-white/65">Avatars show an approximate area, not an exact location or event attendance. Only members who choose to share appear.</p>
          <LocationControls allowSharing={ready} />
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
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const src = mapAvatarUrl(member.avatarUrl);
  return src && failedSource !== src
    ? <img src={src} alt="" referrerPolicy="no-referrer" className="w-11 h-11 shrink-0 rounded-sm object-cover" onError={() => setFailedSource(src)} />
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

/** Groups are derived from the current authorized members on every render. */
function ClusteredMembers({ members, selfId, initialZoom, onOpen }: { members: MapMember[]; selfId?: string; initialZoom: number; onOpen: (member: MapMember) => void }) {
  const map = useMap();
  const [zoom, setZoom] = useState(initialZoom);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const trigger = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const close = () => { setSelectedIds([]); if (trigger.current?.isConnected) trigger.current.focus(); };
  const hasSelection = selectedIds.length > 0;
  useEffect(() => { if (hasSelection) closeButton.current?.focus(); }, [hasSelection]);
  useEffect(() => {
    if (!map) return;
    const update = () => setZoom(map.getZoom() ?? initialZoom);
    update();
    const listener = map.addListener("zoom_changed", update);
    return () => listener.remove();
  }, [map, initialZoom]);
  const selected = members.filter(member => selectedIds.includes(member.id)).sort((a, b) => Number(b.id === selfId) - Number(a.id === selfId));
  useEffect(() => {
    // Prune selection so a later re-opt-in cannot reopen an old chooser.
    setSelectedIds(ids => {
      const live = ids.filter(id => members.some(member => member.id === id));
      return live.length === ids.length ? ids : live;
    });
  }, [members]);
  return <>
    {clusterMapMembers(members, zoom).map(cluster => {
      if (cluster.members.length === 1) {
        const member = cluster.members[0];
        return <AvatarMarker key={cluster.id} member={member} self={member.id === selfId} onClick={() => onOpen(member)} />;
      }
      const includesSelf = cluster.members.some(member => member.id === selfId);
      const previews = [...cluster.members].sort((a, b) => Number(b.id === selfId) - Number(a.id === selfId)).slice(0, 2);
      return <RoundedMapMarker key={cluster.id} latitude={cluster.latitude} longitude={cluster.longitude}
        title={`${cluster.members.length} people in this area${includesSelf ? ', including you' : ''}. View people`}
        source={null} fallback={String(cluster.members.length)} width={108} height={62}
        onClick={() => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelectedIds(cluster.members.map(member => member.id)); }}>
        <span className="flex flex-col items-center gap-0.5" data-avatar-cluster>
          <span className="flex items-center gap-1">
            {previews.map(member => <span key={member.id} className="relative" data-preview-member={member.id}><span className="block" style={{ width: 30, height: 30, overflow: 'hidden', borderRadius: 4 }}><span className="block origin-top-left" style={{ transform: 'scale(0.682)' }}><Avatar member={member} /></span></span>{member.id === selfId ? <span className="absolute -bottom-1 left-0 right-0 bg-black/80 text-white" style={{ fontSize: 8, lineHeight: '10px' }}>YOU</span> : null}</span>)}
            <span className="text-sm font-bold">{cluster.members.length}</span>
          </span>
          <span style={{ fontSize: 9, lineHeight: '12px' }}>View people</span>
        </span>
      </RoundedMapMarker>;
    })}
    {selected.length ? <section onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} aria-label="People in this area" className="absolute bottom-3 left-3 right-3 z-10 rounded-xl border border-white/20 bg-[#11121d] p-3 shadow-xl" style={{ maxHeight: '75%', overflowY: 'auto' }}>
      <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{selected.length} people in this area</h3><button type="button" ref={closeButton} aria-label="Close people in this area" className="min-h-11 min-w-11 rounded-sm bg-white/10" onClick={close}>×</button></div>
      <p className="text-xs text-white/60 mb-2">Approximate area · not an exact location</p>
      <ul className="grid sm:grid-cols-2 gap-2">{selected.map(member => <li key={member.id} className="min-w-0"><button type="button" className="flex w-full items-center gap-3 rounded-sm p-2 text-left hover:bg-white/10 focus-visible:outline-2" onClick={() => onOpen(member)}><Avatar member={member} /><span className="min-w-0 break-words"><span className="block font-semibold">{member.displayName || member.username}{member.id === selfId ? ' · You' : ''}</span><span className="block text-xs text-white/60">@{member.username}</span></span></button></li>)}</ul>
    </section> : null}
  </>;
}
