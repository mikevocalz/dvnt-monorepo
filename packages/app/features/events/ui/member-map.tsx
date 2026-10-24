import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useImage } from "expo-image";
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

export default function MemberMap() {
  const router = useRouter();
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
  const members = sharing && !nearby.isError && leaseLive ? visibleMapMembers(nearby.data?.members || [], now) : [];
  const center = sharing && !nearby.isError && leaseLive ? nearby.data?.center : null;
  const cameraPosition = useMemo(() => ({
    coordinates: { latitude: center?.latitude ?? 0, longitude: center?.longitude ?? 0 }, zoom: 12,
  }), [center?.latitude, center?.longitude]);
  const open = (member: MapMember) => router.push(mapMemberProfilePath(member.username, true) as any);
  const onMarker = (event: { id?: string }) => {
    const member = members.find((item) => item.id === event.id);
    if (member) open(member);
  };
  const annotations = members.filter((member) => icons[member.id]).map((member) => ({
    id: member.id, coordinates: { latitude: member.latitude, longitude: member.longitude },
    title: `${member.displayName || member.username} · approximate area`, icon: icons[member.id],
  }));
  const markers = members.filter((member) => Platform.OS !== 'ios' || !icons[member.id]).map((member) => ({
    id: member.id, coordinates: { latitude: member.latitude, longitude: member.longitude },
    title: `${member.displayName || member.username} · approximate area`,
    ...(Platform.OS === 'ios' ? { monogram: mapMemberInitials(member), tintColor: '#8A40CF' } : { icon: icons[member.id], anchor: { x: 0.5, y: 0.5 } }),
  }));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ color: '#bbb', fontSize: 13 }}>Avatars show an approximate area, not an exact location or event attendance. Only members who choose to share appear.</Text>
      <LocationControls allowSharing={Boolean(NativeMap)} />
      {!NativeMap ? <Text accessibilityRole="alert" style={{ color: '#ddd' }}>Nearby people requires a build with native maps. No location is collected here. You can still turn sharing off.</Text> : null}
      {NativeMap && sharing ? <Pressable accessibilityRole="button" disabled={presence.isUpdating} onPress={() => void presence.refresh()} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 12, backgroundColor: "#379ED8" }}><Text style={{ color: "#000", fontWeight: "600" }}>Update my location</Text></Pressable> : null}
      {presence.error ? <Text accessibilityRole="alert" style={{ color: '#ffb4b4' }}>{presence.error}</Text> : null}
      {nearby.isError ? <View><Text accessibilityRole="alert" style={{ color: '#ddd' }}>Nearby people could not be refreshed. Locations have been hidden.</Text><Pressable accessibilityRole="button" onPress={() => void nearby.refetch()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#3FDCFF' }}>Retry nearby people</Text></Pressable></View> : null}
      {NativeMap && sharing && !center && !nearby.isError ? <View style={{ gap: 8 }}>{presence.isUpdating || nearby.isPending ? <ActivityIndicator /> : null}<Text style={{ color: '#bbb' }}>A fresh location is needed to show nearby people.</Text></View> : null}
      {NativeMap && center ? (
        <>
          {members.filter((member) => mapAvatarUrl(member.avatarUrl)).map((member) => <MemberIcon key={`${member.id}:${member.avatarUrl}`} member={member} register={registerIcon} />)}
          <View style={{ height: 340 }} accessibilityLabel="Approximate nearby member locations">
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
          <Text style={{ color: '#bbb' }}>{members.length ? `${members.length} nearby members sharing an approximate area` : 'No nearby members are sharing right now.'}</Text>
          {members.map((member) => <Pressable key={member.id} accessibilityRole="button" accessibilityLabel={`Open ${member.displayName || member.username}'s profile`} onPress={() => open(member)} style={{ minHeight: 60, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#ffffff22', borderRadius: 12 }}><Avatar member={member} /><View style={{ flex: 1 }}><Text style={{ color: '#fff', fontWeight: '600' }}>{member.displayName || member.username}</Text><Text style={{ color: '#aaa' }}>@{member.username} · approximate area</Text></View></Pressable>)}
        </>
      ) : null}
    </ScrollView>
  );
}

function MemberIcon({ member, register }: { member: MapMember; register: (id: string, icon: LoadedIcon | null) => void }) {
  const source = mapAvatarUrl(member.avatarUrl);
  const icon = useImage(source!, { maxWidth: 44, maxHeight: 44 });
  useEffect(() => {
    register(member.id, icon);
    return () => register(member.id, null);
  }, [member.id, icon, register]);
  return null;
}

function Avatar({ member }: { member: MapMember }) {
  const [failed, setFailed] = useState(false);
  const source = mapAvatarUrl(member.avatarUrl);
  return source && !failed ? <Image source={{ uri: source }} onError={() => setFailed(true)} style={{ width: 44, height: 44, borderRadius: 22 }} /> : <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#8A40CF', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>{mapMemberInitials(member)}</Text></View>;
}
