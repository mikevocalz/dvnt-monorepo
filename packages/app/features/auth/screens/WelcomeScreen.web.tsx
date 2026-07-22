import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'solito/navigation';
import { toast } from 'sonner';
import { MapPin, Check } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useAuthStore } from '../../../lib/stores/auth-store';
import { useEventsLocationStore, type City } from '../../../lib/stores/events-location-store';
import { usersApi } from '../../../lib/api/users';
import { citiesApi } from '../../../lib/api/cities';
import { supabase } from '../../../lib/supabase/client';
import { IDENTITY_OPTIONS, AUDIENCE_OPTIONS } from '../../../lib/constants/identity';
import { AUTH_PRIMARY_COLOR as P } from './AuthScreens.shared';

/**
 * Post-signup welcome flow (web): identity → event audience → location.
 * Collected for event/feed filtering; private, never shown on the profile.
 * Login routes here once per user (localStorage flag) — the screen
 * self-skips to /feed when the profile already has the data.
 */

export const welcomeDoneKey = (userId: string) => `dvnt-welcome-${userId}`;

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: selected ? P : 'rgba(255,255,255,0.18)',
        backgroundColor: selected ? 'rgba(62,164,229,0.16)' : 'rgba(255,255,255,0.04)',
      }}
    >
      {selected ? <Check size={14} color={P} /> : null}
      <Text style={{ color: selected ? '#fff' : 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function WelcomeScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<string[]>([]);
  const [audience, setAudience] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const markDoneAndGo = () => {
    if (user?.id && typeof localStorage !== 'undefined') {
      localStorage.setItem(welcomeDoneKey(user.id), '1');
    }
    router.replace('/feed');
  };

  // Prefill from the profile row; if identity is already saved, this user
  // has been through onboarding (maybe on mobile) — skip straight to feed.
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('sexuality, event_audience')
          .eq('id', Number(user.id))
          .maybeSingle();
        if (data?.sexuality?.length) {
          updateUser({ sexuality: data.sexuality, eventAudience: data.event_audience || undefined });
          markDoneAndGo();
          return;
        }
        if (user.sexuality?.length) setIdentity(user.sexuality);
        if (user.eventAudience) setAudience(user.eventAudience);
      } catch {
        // Prefill is best-effort — the flow works from a blank slate.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const toggleIdentity = (label: string) =>
    setIdentity((prev) =>
      prev.includes(label) ? prev.filter((i) => i !== label) : [...prev, label],
    );

  const savePreferences = async () => {
    if (!identity.length && !audience) {
      // Nothing chosen — the edge function requires at least one field.
      setStep(2);
      return;
    }
    setSaving(true);
    try {
      await usersApi.updateProfile({
        ...(identity.length ? { sexuality: identity } : {}),
        ...(audience ? { eventAudience: audience } : {}),
      });
      updateUser({ sexuality: identity, eventAudience: audience || undefined });
      setStep(2);
    } catch (err: any) {
      toast.error('Could not save preferences', {
        description: err?.message || 'Please try again.',
      });
    }
    setSaving(false);
  };

  const enableLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('Location unavailable', { description: 'Your browser does not support location.' });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const { setDeviceLocation, setLocationMode, setActiveCity } =
          useEventsLocationStore.getState();
        setDeviceLocation(latitude, longitude);
        setLocationMode('device');
        try {
          // Snap to the nearest known city so event filters have a name.
          const cities: City[] = await citiesApi.getCities();
          let nearest: City | null = null;
          let best = Infinity;
          for (const c of cities) {
            const d = (c.lat - latitude) ** 2 + (c.lng - longitude) ** 2;
            if (d < best) {
              best = d;
              nearest = c;
            }
          }
          if (nearest) setActiveCity(nearest);
          toast.success(nearest ? `Showing events near ${nearest.name}` : 'Location enabled');
        } catch {
          toast.success('Location enabled');
        }
        setLocating(false);
        markDoneAndGo();
      },
      () => {
        setLocating(false);
        toast.error('Location was blocked', {
          description: 'You can enable it anytime from the events page.',
        });
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const steps: {
    title: string;
    subtitle: string;
    body: React.ReactNode;
    footer: React.ReactNode;
  }[] = [
    {
      title: 'I am…',
      subtitle: 'Pick all that fit. Private — used only to tune your events and feed, never shown on your profile.',
      body: (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {IDENTITY_OPTIONS.map((label) => (
            <Chip key={label} label={label} selected={identity.includes(label)} onPress={() => toggleIdentity(label)} />
          ))}
        </View>
      ),
      footer: <Button onPress={() => setStep(1)}>Continue</Button>,
    },
    {
      title: 'Looking for events with…',
      subtitle: 'We’ll put these events first. You can change this anytime in settings.',
      body: (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {AUDIENCE_OPTIONS.map((label) => (
            <Chip key={label} label={label} selected={audience === label} onPress={() => setAudience(audience === label ? '' : label)} />
          ))}
        </View>
      ),
      footer: (
        <Button onPress={savePreferences} disabled={saving} loading={saving}>
          Continue
        </Button>
      ),
    },
    {
      title: 'See what’s near you',
      subtitle: 'Turn on location to see events happening around you — not everywhere. Only used while you browse.',
      body: (
        <View style={{ alignItems: 'center', paddingVertical: 18 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(62,164,229,0.16)',
              borderWidth: 1,
              borderColor: 'rgba(62,164,229,0.4)',
            }}
          >
            <MapPin size={32} color={P} />
          </View>
        </View>
      ),
      footer: (
        <Button onPress={enableLocation} disabled={locating} loading={locating}>
          Enable location
        </Button>
      ),
    },
  ];

  const current = steps[step];

  return (
    <ScrollView
      style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }}
      contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}
    >
      <View style={{ position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(62,164,229,0.18)', top: -140, right: -140, filter: 'blur(56px)' } as any} />
      <View style={{ position: 'absolute', width: 340, height: 340, borderRadius: 170, backgroundColor: 'rgba(255,109,193,0.10)', bottom: -120, left: -120, filter: 'blur(54px)' } as any} />
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', padding: 28 }}>
        <Text style={{ color: 'rgba(255,255,255,0.50)', fontSize: 11, fontWeight: '900', letterSpacing: 3, textTransform: 'uppercase' }}>
          Welcome to DVNT
        </Text>
        <Text style={{ marginTop: 14, color: '#fff', fontSize: 32, lineHeight: 38, fontWeight: '900' }}>{current.title}</Text>
        <Text style={{ marginTop: 10, color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 21 }}>{current.subtitle}</Text>

        <View style={{ marginTop: 24 }}>{current.body}</View>

        <View style={{ marginTop: 28, gap: 12 }}>
          {current.footer}
          <Pressable onPress={step === 2 ? markDoneAndGo : () => (step === 1 ? savePreferences() : setStep(step + 1))} accessibilityRole="button">
            <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '700', textAlign: 'center' }}>
              {step === 2 ? 'Not now' : 'Skip'}
            </Text>
          </Pressable>
        </View>

        {/* Progress — pink accent matches the mobile onboarding brand dot. */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 24 }}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={{
                width: i === step ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === step ? '#FF5BFC' : 'rgba(255,255,255,0.25)',
              }}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
