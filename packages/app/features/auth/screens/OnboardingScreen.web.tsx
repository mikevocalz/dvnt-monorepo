import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'solito/navigation';
import { Button } from '../../../components/ui/button';
import { AUTH_PRIMARY_COLOR as P } from './AuthScreens.shared';

export function OnboardingScreen() {
  // Next app uses Solito/Next routing (no TanStack RouterProvider).
  const router = useRouter();
  const navigate = ({ to }: { to: string }) => router.push(to);

  return (
    <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
      <View style={{ position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(62,164,229,0.18)', top: -140, right: -140, filter: 'blur(56px)' } as any} />
      <View style={{ position: 'absolute', width: 340, height: 340, borderRadius: 170, backgroundColor: 'rgba(255,109,193,0.10)', bottom: -120, left: -120, filter: 'blur(54px)' } as any} />
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 24, alignItems: 'center' }}>
        <View style={{ gap: 10, alignItems: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.50)', fontSize: 11, fontWeight: '900', letterSpacing: 3, textTransform: 'uppercase' }}>DVNT.APP</Text>
          <Text style={{ color: '#fff', fontSize: 38, fontWeight: '900', textAlign: 'center', lineHeight: 44 }}>connect. gather. move.</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16, textAlign: 'center', lineHeight: 24, fontWeight: '600', maxWidth: 360 }}>A social layer for nightlife, community, private conversations, and curated access.</Text>
        </View>
        <View style={{ width: '100%', gap: 14 }}>
          {(['Discover events worth pulling up to.', 'Keep conversations private and intentional.', 'Control your profile signal.'] as const).map((note) => (
            <View key={note} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: P, marginTop: 7 }} />
              <Text style={{ color: 'rgba(255,255,255,0.70)', fontSize: 15, lineHeight: 22 }}>{note}</Text>
            </View>
          ))}
        </View>
        <View style={{ width: '100%', gap: 12, marginTop: 8 }}>
          <Button onPress={() => navigate({ to: '/auth/signup' })}>Get started</Button>
          <Button variant="secondary" onPress={() => navigate({ to: '/auth/login' })}>Sign in</Button>
        </View>
      </View>
    </ScrollView>
  );
}
