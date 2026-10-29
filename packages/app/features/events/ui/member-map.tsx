import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useImage } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import type { Event } from "@dvnt/app/lib/hooks/use-events";
import { eventMapApi } from "@dvnt/app/lib/api/event-map";
import { eventMapIds, eventMapPins, eventListAllowsMap, attachEventMapFlyers } from "@dvnt/app/lib/events/event-map";
import { useRouter } from "expo-router";
import { LocationControls } from "@dvnt/app/features/settings/ui/LocationControls";
import { useLocationSettings, useMemberMapPresence, useNearbyMembers } from "@dvnt/app/lib/hooks/use-member-map";
import { mapAvatarUrl, mapMemberInitials, mapMemberProfilePath, visibleMapMembers, type MapMember } from "./member-map-render-policy";

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
  // fresh consented coarse center, show an explicitly labelled broad overview.
  const ownArea = presence.area || center;
  const cameraPosition = useMemo(() => ({
    coordinates: { latitude: ownArea?.latitude ?? 39.5, longitude: ownArea?.longitude ?? -98.35 },
    zoom: ownArea ? 12 : 3,
  }), [ownArea?.latitude, ownArea?.longitude, presence.area?.expiresAt]);
  const open = (member: MapMember) => router.push(mapMemberProfilePath(member.username, true) as any);
  const onMarker = (event: { id?: string }) => {
    if (event.id?.startsWith('event:')) {
      const pin = eventPins.find(item => `event:${item.id}` === event.id);
      if (pin) openEvent(pin.id);
      return;
    }
    const member = members.find(item => `member:${item.id}` === event.id);
    if (member) open(member);
  };
  const visualPins = [
    ...eventPins.map(pin => ({ id: `event:${pin.id}`, latitude: pin.latitude, longitude: pin.longitude, title: pin.title, image: pin.flyerUrl, monogram: 'E', tint: '#379ED8' })),
    ...members.map(member => ({ id: `member:${member.id}`, latitude: member.latitude, longitude: member.longitude,
      title: `${nearby.data?.self?.id === member.id ? 'You' : member.displayName || member.username} · approximate area`, image: mapAvatarUrl(member.avatarUrl), monogram: mapMemberInitials(member), tint: '#8A40CF' })),
  ];
  const annotations = visualPins.filter(pin => icons[pin.id]).map(pin => ({
    id: pin.id, coordinates: { latitude: pin.latitude, longitude: pin.longitude }, title: pin.title, icon: icons[pin.id],
  }));
  const markers = visualPins.filter(pin => Platform.OS !== 'ios' || !icons[pin.id]).map(pin => ({
    id: pin.id, coordinates: { latitude: pin.latitude, longitude: pin.longitude }, title: pin.title,
    ...(Platform.OS === 'ios' ? { monogram: pin.monogram, tintColor: pin.tint } : { icon: icons[pin.id], anchor: { x: 0.5, y: 0.5 } }),
  }));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ color: '#bbb', fontSize: 13 }}>Party flyers and member avatars share this map. Avatars show an approximate area, not an exact location or event attendance. Only members who choose to share appear.</Text>
      {!center ? <Text accessibilityRole="text" style={{ color: '#bbb', fontSize: 13 }}>Showing a broad overview of public event locations, not your current location.</Text> : null}
      <LocationControls allowSharing={Boolean(NativeMap)} />
      {!NativeMap ? <Text accessibilityRole="alert" style={{ color: '#ddd' }}>This map requires a build with native maps. No location is collected here. You can still turn sharing off.</Text> : null}
      {presence.error ? <Text accessibilityRole="alert" style={{ color: '#ffb4b4' }}>{presence.error}</Text> : null}
      {nearby.isError ? <View><Text accessibilityRole="alert" style={{ color: '#ddd' }}>Nearby people could not be refreshed. Member locations have been hidden.</Text><Pressable accessibilityRole="button" onPress={() => void nearby.refetch()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#3FDCFF' }}>Retry nearby people</Text></Pressable></View> : null}
      {NativeMap && sharing && !center && !nearby.isError ? <View style={{ gap: 8 }}>{presence.isUpdating || nearby.isPending ? <ActivityIndicator /> : null}<Text style={{ color: '#bbb' }}>A fresh location is needed to show nearby people.</Text></View> : null}
      {NativeMap ? (
        <>
          {visualPins.filter(pin => pin.image).map(pin => <MapIcon key={`${pin.id}:${pin.image}`} id={pin.id} source={pin.image!} register={registerIcon} />)}
          <View style={{ height: 340 }} accessibilityLabel="Event flyers and approximate member locations">
            <NativeMap
              style={{ flex: 1 }}
              cameraPosition={cameraPosition}
              markers={markers}
              {...(Platform.OS === 'ios' ? { annotations, onAnnotationClick: onMarker } : {})}
              onMarkerClick={onMarker}
              properties={{ isMyLocationEnabled: false, showsUserLocation: false }}
              uiSettings={{ myLocationButtonEnabled: false }}
            />
          </View>
          <Text style={{ color: '#bbb' }}>{`${eventPins.length} public event locations · ${members.length} sharing avatars`}</Text>
          {locations.isError ? <View><Text accessibilityRole="alert" style={{ color: '#ddd' }}>Event locations could not be refreshed. Event pins have been hidden.</Text><Pressable accessibilityRole="button" onPress={() => void locations.refetch()}><Text style={{ color: '#3FDCFF', paddingVertical: 12 }}>Retry event locations</Text></Pressable></View> : null}
          {eventPins.map(pin => <Pressable key={pin.id} accessibilityRole="button" accessibilityLabel={`Open event ${pin.title}`} onPress={() => openEvent(pin.id)} style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {pin.flyerUrl ? <Image source={{ uri: pin.flyerUrl }} style={{ width: 44, height: 58, borderRadius: 6 }} /> : null}<Text style={{ color: '#fff', flex: 1 }}>{pin.title}</Text>
          </Pressable>)}
          {members.map((member) => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`Open ${member.displayName || member.username}'s profile`} onPress={() => open(member)} style={{ minHeight: 60, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#ffffff22', borderRadius: 12 }}><Avatar member={member} /><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontWeight: '600' }}>{member.displayName || member.username}</Text><Text style={{ color: '#aaa' }}>@{member.username} · approximate area</Text></View></Pressable>)}
        </>
      ) : null}
    </ScrollView>
  );
}

function MapIcon({ id, source, register }: { id: string; source: string; register: (id: string, icon: LoadedIcon | null) => void }) {
  const icon = useImage(source, { maxWidth: 44, maxHeight: 58 });
  useEffect(() => {
    register(id, icon);
    return () => register(id, null);
  }, [id, icon, register]);
  return null;
}

function Avatar({ member }: { member: MapMember }) {
  const [failed, setFailed] = useState(false);
  const source = mapAvatarUrl(member.avatarUrl);
  return source && !failed ? <Image source={{ uri: source }} onError={() => setFailed(true)} style={{ width: 44, height: 44, borderRadius: 22 }} /> : <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#8A40CF', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>{mapMemberInitials(member)}</Text></View>;
}
