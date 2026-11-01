import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { MAP_SHARING_DISCLOSURE, useMapSharingPrompt } from "./map-sharing-prompt";

export function MapSharingConsent({ active, promptOnly = false }: { active: boolean; promptOnly?: boolean }) {
  const owner = useAuthStore(state => state.user?.authId);
  return owner ? <OwnedConsent key={owner} owner={owner} active={active} promptOnly={promptOnly} /> : null;
}
function OwnedConsent({ owner, active, promptOnly }: { owner: string; active: boolean; promptOnly: boolean }) {
  // Only the Events-page instance auto-prompts. The map keeps manual controls.
  const flow = useMapSharingPrompt(owner, active, promptOnly);
  const busy = flow.consent.busy || flow.location.busy;
  return <View accessibilityLabel="Map sharing" style={promptOnly ? undefined : { borderWidth: 1, borderColor: '#ffffff30', borderRadius: 12, padding: 16, gap: 12 }}>
    {!promptOnly ? <>
      {flow.location.sharing ? <>
      <Text style={{ color: '#ddd' }}>Avatar sharing is on until {new Date(flow.location.settings!.shareUntil!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Your avatar appears when a fresh location is available.</Text>
      <Pressable accessibilityRole="button" disabled={flow.location.busy} onPress={flow.stop} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#3FDCFF' }}>Stop sharing</Text></Pressable>
    </> : <>
      <Text style={{ color: '#ddd' }}>Show your avatar on this map for 4 hours. Sharing is optional.</Text>
      <Pressable accessibilityRole="button" disabled={!flow.available || busy} onPress={flow.show} style={{ minHeight: 44, justifyContent: 'center', opacity: !flow.available || busy ? 0.4 : 1 }}><Text style={{ color: '#3FDCFF' }}>Show my avatar</Text></Pressable>
    </>}
    {flow.location.error ? <View><Text accessibilityRole="alert" style={{ color: '#fcd34d' }}>{flow.location.error}</Text>{flow.location.needsLocationStop ? <Pressable accessibilityRole="button" disabled={flow.location.busy} onPress={() => void flow.location.setOverall(false)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#3FDCFF' }}>Turn all location off</Text></Pressable> : <Pressable accessibilityRole="button" onPress={() => void flow.location.refresh()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: '#3FDCFF' }}>Reload settings</Text></Pressable>}</View> : null}
    {flow.success && flow.location.sharing ? <Text accessibilityLiveRegion="polite" style={{ color: '#ddd' }}>Your approximate location was shared. Your avatar will appear as the map refreshes.</Text> : null}
      {!flow.open && flow.consent.error ? <Text accessibilityRole="alert" style={{ color: '#fcd34d' }}>{flow.consent.error}</Text> : null}
    </> : null}
    <Modal visible={flow.open && active} transparent animationType="fade" onRequestClose={flow.dismiss}>
      <View style={{ flex: 1, backgroundColor: '#000b', justifyContent: 'center', padding: 24 }}>
        <ScrollView accessibilityViewIsModal style={{ maxHeight: '90%', backgroundColor: '#11121d', borderRadius: 16 }} contentContainerStyle={{ padding: 24, gap: 16 }}>
          <Text accessibilityRole="header" style={{ color: '#fff', fontSize: 22, fontWeight: '600' }}>Show your avatar on the map?</Text>
          <Text style={{ color: '#ddd', lineHeight: 22 }}>{MAP_SHARING_DISCLOSURE}</Text>
          <Text style={{ color: '#ddd', lineHeight: 22 }}>Choose Share my location, then Allow if your device asks. Not now keeps you hidden.</Text>
          {flow.consent.error ? <Text accessibilityRole="alert" style={{ color: '#fcd34d' }}>{flow.consent.error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void flow.share()} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#379ED8', borderRadius: 12, opacity: busy ? 0.4 : 1 }}><Text style={{ color: '#000', fontWeight: '600' }}>{busy ? 'Waiting for location…' : 'Share my location'}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={flow.dismiss} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: '#fff' }}>Not now</Text></Pressable>
        </ScrollView>
      </View>
    </Modal>
  </View>;
}
