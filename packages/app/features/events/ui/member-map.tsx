import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useImage } from "expo-image";
import { MAP_MARKER_RADIUS, roundedNativeMapIcon, roundedNativeMapPlaceholder } from "./native-map-icon";
import { useQuery } from "@tanstack/react-query";
import type { Event } from "@dvnt/app/lib/hooks/use-events";
import { eventMapApi } from "@dvnt/app/lib/api/event-map";
import { eventMapIds, eventMapPins, eventListAllowsMap, attachEventMapFlyers } from "@dvnt/app/lib/events/event-map";
import { useRouter } from "expo-router";
import { useEventsLocationStore } from "@dvnt/app/lib/stores/events-location-store";
import { savedMapArea } from "./member-map-area";
import { LocationControls } from "@dvnt/app/features/settings/ui/LocationControls";
import { useLocationSettings, useMemberMapPresence, useNearbyMembers } from "@dvnt/app/lib/hooks/use-member-map";
import { mapAvatarUrl, mapMemberInitials, mapMemberProfilePath, visibleMapMembers, type MapMember } from "./member-map-render-policy";

import { clusterMapMembers } from "./member-map-clusters";
import { nativeMapClusterIcon, nativeMapClusterPlaceholder, CLUSTER_ICON_WIDTH, CLUSTER_ICON_HEIGHT } from "./native-map-cluster-icon";

// Keep the existing expo-maps provider. An unlinked Expo Go build must not
// start collecting location for a surface it cannot display.
let NativeMap: React.ComponentType<any> | null = null;
try {
  const maps = require("expo-maps");
  NativeMap = Platform.OS === "ios" ? maps.AppleMaps.View : Platform.OS === "android" ? maps.GoogleMaps.View : null;
} catch { /* The explicit unavailable state below remains usable. */ }

type LoadedIcon = NonNullable<ReturnType<typeof useImage>>;

export default function MemberMap({ events = [], onOpenEvent }: { events?: Event[]; onOpenEvent?: (id: string) => void } = {}) {
  const router = useRouter();
  const ids = eventMapIds(events.filter(event => eventListAllowsMap(event)).map(event => String(event.id)));
  const locations = useQuery({
    queryKey: ["events-map", ids],
    queryFn: ({ signal }) => eventMapApi.getLocations(ids, signal),
    enabled: ids.length > 0, staleTime: 0, gcTime: 0, retry: 1,
    refetchOnWindowFocus: true, refetchInterval: 30_000,
  });
  const eventPins = attachEventMapFlyers(eventMapPins(locations.isError ? [] : locations.data || [], ids), events);
  const openEvent = (id: string) => onOpenEvent ? onOpenEvent(id) : router.push(`/(protected)/events/${id}` as any);
  const { sharing } = useLocationSettings();
  const savedCity = useEventsLocationStore((state) => state.activeCity);
  const savedArea = savedMapArea(savedCity);
  const presence = useMemberMapPresence(Boolean(NativeMap));
  const nearby = useNearbyMembers(Boolean(NativeMap));
  const [now, setNow] = useState(Date.now);
  const [icons, setIcons] = useState<Record<string, LoadedIcon>>({});
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const registerIcon = useCallback((id: string, icon: LoadedIcon | null) => {
    setIcons((current) => {
      if (current[id] === icon || (!current[id] && !icon)) return current;
      const next = { ...current };
      if (icon) next[id] = icon; else delete next[id];
      return next;
    });
  }, []);
  const leaseLive = nearby.data?.expiresAt && Date.parse(nearby.data.expiresAt) > now;
  const members = sharing && !nearby.isError && leaseLive ? visibleMapMembers([...(nearby.data?.self ? [nearby.data.self] : []), ...(nearby.data?.members || [])], now) : [];
  const center = sharing && !nearby.isError && leaseLive ? nearby.data?.center : null;
  // A public event venue is not evidence of the viewer's location. Without a
  // fresh permitted center, use the saved city only as a labeled viewport.
  const ownArea = presence.area || center;
  const viewportArea = ownArea || savedArea;
  const cameraPosition = useMemo(() => ({
    coordinates: { latitude: viewportArea?.latitude ?? 39.5, longitude: viewportArea?.longitude ?? -98.35 },
    zoom: ownArea ? 12 : savedArea ? 8 : 3,
  }), [viewportArea?.latitude, viewportArea?.longitude, Boolean(ownArea), Boolean(savedArea), presence.area?.expiresAt]);
  const [zoom, setZoom] = useState(cameraPosition.zoom);
  useEffect(() => setZoom(cameraPosition.zoom), [cameraPosition]);
  const groups = clusterMapMembers(members, zoom);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedMembers = members.filter(member => selectedIds.includes(member.id));
  useEffect(() => {
    const currentIds = selectedMembers.map(member => member.id);
    if (currentIds.length !== selectedIds.length) setSelectedIds(currentIds);
  }, [selectedMembers.map(member => member.id).join('|'), selectedIds.length]);
  const clusterTitle = (groupMembers: MapMember[]) => `${groupMembers.length} people${groupMembers.some(member => member.id === nearby.data?.self?.id) ? ' including you' : ''} · approximate area`;
  const open = (member: MapMember) => router.push(mapMemberProfilePath(member.username, true) as any);
  const onMarker = (event: { id?: string }) => {
    if (event.id?.startsWith('event:')) {
      const pin = eventPins.find(item => `event:${item.id}` === event.id);
      if (pin) openEvent(pin.id);
      return;
    }
    const group = groups.find(item => item.id === event.id);
    if (group?.members.length === 1) open(group.members[0]);
    else if (group) setSelectedIds(group.members.map(member => member.id));
  };
  const visualPins = [
    ...eventPins.map(pin => ({ id: `event:${pin.id}`, latitude: pin.latitude, longitude: pin.longitude, title: pin.title, image: pin.flyerUrl, monogram: 'E', tint: '#379ED8' })),
    ...groups.filter(group => group.members.length === 1).map(group => group.members[0]).map(member => ({ id: `member:${member.id}`, latitude: member.latitude, longitude: member.longitude,
      title: `${nearby.data?.self?.id === member.id ? 'You' : member.displayName || member.username} · approximate area`, image: mapAvatarUrl(member.avatarUrl), monogram: mapMemberInitials(member), tint: '#8A40CF' })),
  ];
  const clusterPins = groups.filter(group => group.members.length > 1).map(group => ({ ...group, title: clusterTitle(group.members) }));
  const allPins = [...visualPins, ...clusterPins];
  const annotations = allPins.filter(pin => icons[pin.id]).map(pin => ({
    id: pin.id, coordinates: { latitude: pin.latitude, longitude: pin.longitude }, title: pin.title, icon: icons[pin.id],
  }));
  // Never flash provider-default round/pin shapes while rounded PNGs load.
  const markers = allPins.filter(pin => Platform.OS !== 'ios' && icons[pin.id]).map(pin => ({
    id: pin.id, coordinates: { latitude: pin.latitude, longitude: pin.longitude }, title: pin.title,
    icon: icons[pin.id], anchor: { x: 0.5, y: 0.5 },
  }));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ color: '#bbb', fontSize: 13 }}>Party flyers and member avatars share this map. Avatars show an approximate area, not an exact location or event attendance. Only members who choose to share appear.</Text>
      {!ownArea ? <Text accessibilityRole="text" style={{ color: '#bbb', fontSize: 13 }}>{savedArea ? `Showing your saved area: ${savedArea.label}. This is not a current device location.` : 'Showing a broad overview of public event locations, not your current location.'}</Text> : null}
      <LocationControls allowSharing={Boolean(NativeMap)} />
      {!NativeMap ? <Text accessibilityRole="alert" style={{ color: '#ddd' }}>This map requires a build with native maps. No location is collected here. You can still turn sharing off.</Text> : null}
      {presence.error ? <Text accessibilityRole="alert" style={{ color: '#ffb4b4' }}>{presence.error}</Text> : null}
      {nearby.isError ? <View><Text accessibilityRole="alert" style={{ color: '#ddd' }}>Nearby people could not be refreshed. Member locations have been hidden.</Text><Pressable accessibilityRole="button" onPress={() => void nearby.refetch()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#3FDCFF' }}>Retry nearby people</Text></Pressable></View> : null}
      {NativeMap && sharing && !center && !nearby.isError ? <View style={{ gap: 8 }}>{presence.isUpdating || nearby.isPending ? <ActivityIndicator /> : null}<Text style={{ color: '#bbb' }}>A fresh location is needed to show nearby people.</Text></View> : null}
      {NativeMap ? (
        <>
          {visualPins.map(pin => <MapIcon key={`${pin.id}:${pin.image}:${pin.monogram}`} id={pin.id} source={pin.image || null} label={pin.monogram} color={pin.tint} height={pin.id.startsWith("event:") ? 58 : 44} register={registerIcon} />)}
          {clusterPins.map(pin => <ClusterIcon key={pin.id} id={pin.id} members={pin.members} selfId={nearby.data?.self?.id} register={registerIcon} />)}
          <Modal visible={selectedMembers.length > 0} transparent animationType="fade" onRequestClose={() => setSelectedIds([])}>
            <View style={{ flex: 1, backgroundColor: '#0009', justifyContent: 'center', alignItems: 'center', padding: 16 }}>
              <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 480, maxHeight: '80%', backgroundColor: '#18151e', borderRadius: 16, padding: 16, gap: 12 }}>
                <Text accessibilityRole="header" style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{clusterTitle(selectedMembers)}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close people cluster" onPress={() => setSelectedIds([])} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#3FDCFF' }}>Close</Text></Pressable>
                <ScrollView>{selectedMembers.map(member => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`View ${member.displayName || member.username}${member.id === nearby.data?.self?.id ? ' (You)' : ''} profile`} onPress={() => { setSelectedIds([]); open(member); }} style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Avatar member={member} /><Text style={{ color: '#fff', flex: 1 }}>{member.displayName || member.username}{member.id === nearby.data?.self?.id ? ' (You)' : ''}</Text></Pressable>)}</ScrollView>
              </View>
            </View>
          </Modal>
          <View style={{ height: 340 }} accessibilityLabel="Event flyers and approximate member locations">
            <NativeMap
              style={{ flex: 1 }}
              cameraPosition={cameraPosition}
              markers={markers}
              {...(Platform.OS === 'ios' ? { annotations, onAnnotationClick: onMarker } : {})}
              onMarkerClick={onMarker}
              onCameraMove={(event: { zoom: number }) => { if (Number.isFinite(event.zoom)) setZoom(event.zoom); }}
              properties={{ isMyLocationEnabled: false, showsUserLocation: false }}
              uiSettings={{ myLocationButtonEnabled: false }}
            />
          </View>
          <Text style={{ color: '#bbb' }}>{`${eventPins.length} public event locations · ${members.length} sharing avatars`}</Text>
          {locations.isError ? <View><Text accessibilityRole="alert" style={{ color: '#ddd' }}>Event locations could not be refreshed. Event pins have been hidden.</Text><Pressable accessibilityRole="button" onPress={() => void locations.refetch()}><Text style={{ color: '#3FDCFF', paddingVertical: 12 }}>Retry event locations</Text></Pressable></View> : null}
          {eventPins.map(pin => <Pressable key={pin.id} accessibilityRole="button" accessibilityLabel={`Open event ${pin.title}`} onPress={() => openEvent(pin.id)} style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {pin.flyerUrl ? <Image source={{ uri: pin.flyerUrl }} style={{ width: 44, height: 58, borderRadius: MAP_MARKER_RADIUS }} /> : null}<Text style={{ color: '#fff', flex: 1 }}>{pin.title}</Text>
          </Pressable>)}
          {members.map((member) => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`Open ${member.displayName || member.username}'s profile`} onPress={() => open(member)} style={{ minHeight: 60, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#ffffff22', borderRadius: 12 }}><Avatar member={member} /><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontWeight: '600' }}>{member.displayName || member.username}</Text><Text style={{ color: '#aaa' }}>@{member.username} · approximate area</Text></View></Pressable>)}
        </>
      ) : null}
    </ScrollView>
  );
}

function MapIcon({ id, source, label, color, height, register }: { id: string; source: string | null; label: string; color: string; height: number; register: (id: string, icon: LoadedIcon | null) => void }) {
  const placeholder = useMemo(() => roundedNativeMapPlaceholder(label, color, height), [label, color, height]);
  const [roundedSource, setRoundedSource] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setRoundedSource(null);
    if (!source) return () => { current = false; };
    void roundedNativeMapIcon(source, height, () => current)
      .then((result) => { if (current) setRoundedSource(result); })
      .catch(() => { if (current) setRoundedSource(null); });
    return () => { current = false; };
  }, [source, height]);
  const readySource = roundedSource || placeholder;
  // Expo useImage requires a real source. Remounting also clears its retained
  // old image reference before a newer bitmap is registered.
  return readySource ? <LoadedMapIcon key={readySource} id={id} source={readySource} height={height} register={register} /> : null;
}

function LoadedMapIcon({ id, source, height, register }: { id: string; source: string; height: number; register: (id: string, icon: LoadedIcon | null) => void }) {
  const icon = useImage(source, { maxWidth: 44, maxHeight: height });
  useEffect(() => {
    register(id, icon);
    return () => register(id, null);
  }, [id, icon, register]);
  return null;
}

function Avatar({ member }: { member: MapMember }) {
  const [failed, setFailed] = useState(false);
  const source = mapAvatarUrl(member.avatarUrl);
  return source && !failed ? <Image source={{ uri: source }} onError={() => setFailed(true)} style={{ width: 44, height: 44, borderRadius: MAP_MARKER_RADIUS }} /> : <View style={{ width: 44, height: 44, borderRadius: MAP_MARKER_RADIUS, backgroundColor: '#8A40CF', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>{mapMemberInitials(member)}</Text></View>;
}

function ClusterIcon({ id, members, selfId, register }: { id: string; members: MapMember[]; selfId?: string; register: (id: string, icon: LoadedIcon | null) => void }) {
  const [source, setSource] = useState<string | null>(null);
  const signature = JSON.stringify(members.map(member => [member.id, member.avatarUrl, member.displayName, member.username]));
  useEffect(() => {
    let current = true;
    setSource(null);
    let enhanced = false;
    void nativeMapClusterPlaceholder(members, selfId, () => current).then(value => { if (current && !enhanced) setSource(value); });
    void nativeMapClusterIcon(members, selfId, () => current).then(value => { if (current && value) { enhanced = true; setSource(value); } });
    return () => { current = false; };
  }, [signature, selfId]);
  return source ? <LoadedClusterIcon key={source} id={id} source={source} register={register} /> : null;
}
function LoadedClusterIcon({ id, source, register }: { id: string; source: string; register: (id: string, icon: LoadedIcon | null) => void }) {
  const icon = useImage(source, { maxWidth: CLUSTER_ICON_WIDTH, maxHeight: CLUSTER_ICON_HEIGHT });
  useEffect(() => { register(id, icon); return () => register(id, null); }, [id, icon, register]);
  return null;
}
