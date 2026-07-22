import { useEffect, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useForm } from '@tanstack/react-form';
import { useRouter } from 'solito/navigation';
import Hls from 'hls.js';
import { toast } from 'sonner';
import { HERO_VIDEO_PLAYLIST, LANDING_COLORS } from '../../screens/landing/theme';
import { Button } from '../../../components/ui/button';
import { FormInput } from '../../../components/form';
import { signIn } from '../../../lib/auth-client';
import { useAuthStore } from '../../../lib/stores/auth-store';
import { useLoginUiStore } from '../../../lib/stores/login-ui-store';
import { syncAuthUser } from '../../../lib/api/privileged';
import { auth } from '../../../lib/api/auth';
import { readReturnToFromUrl } from '../../../lib/auth/return-to';
import { AUTH_PRIMARY_COLOR as P } from './AuthScreens.shared';

/**
 * Web login — mirrors the native sign-in screen (app/(auth)/login.tsx): the same
 * dvntapp background video + gradient overlay, "Welcome back" layout, email/
 * password form, and signIn.email → syncAuthUser → setUser flow. Native-only
 * bits are dropped per PROMPT 0 §1: keyboard-aware scroll, deep-link replay, and
 * Apple sign-in (expo-apple-authentication has no web equivalent here).
 */
export function LoginScreen() {
  const { setUser } = useAuthStore();
  const { isSubmitting, setSubmitting } = useLoginUiStore();
  const router = useRouter();

  // Background video — the SAME live HLS stream as the landing hero
  // (HERO_VIDEO_PLAYLIST). Safari plays HLS natively; Chrome/Firefox via hls.js.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(HERO_VIDEO_PLAYLIST);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = HERO_VIDEO_PLAYLIST;
    }
    const tryPlay = () => video.play().catch(() => {});
    video.addEventListener('canplay', tryPlay);
    tryPlay();
    return () => {
      video.removeEventListener('canplay', tryPlay);
      hls?.destroy();
    };
  }, []);

  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value }) => {
      setSubmitting(true);
      try {
        const { data, error } = await signIn.email({
          email: value.email,
          password: value.password,
        });

        if (error) throw new Error((error as any).message || 'Login failed');

        if (data?.user) {
          // Sync user to the app's users table (creates row if needed), falling
          // back to a direct profile read — same as native.
          let profile: any;
          try {
            profile = await syncAuthUser();
          } catch (syncError: any) {
            console.warn('[Login] syncAuthUser failed:', syncError?.message || syncError);
            profile = await auth.getProfile(data.user.id, data.user.email);
          }

          if (profile) {
            setUser({
              id: profile.id,
              email: profile.email,
              username: profile.username,
              name: profile.name,
              avatar: profile.avatar || '',
              bio: profile.bio || '',
              website: profile.website || '',
              location: profile.location || '',
              hashtags: profile.hashtags || [],
              isVerified: profile.isVerified,
              postsCount: profile.postsCount,
              followersCount: profile.followersCount,
              followingCount: profile.followingCount,
            });
            // First login on this browser → welcome flow (identity + location
            // opt-in). The flow self-skips if the profile already has the data.
            const welcomeDone =
              typeof localStorage !== 'undefined' &&
              !!localStorage.getItem(`dvnt-welcome-${profile.id}`);
            // Honor intent: return to the gated URL the user came from
            // (validated internal-only), else the feed.
            router.replace(welcomeDone ? readReturnToFromUrl('/feed') : '/auth/welcome');
          } else {
            toast.error('Login Failed', { description: 'Could not load user profile from database' });
          }
        } else {
          toast.error('Login Failed', { description: 'Could not load user profile' });
        }
      } catch (err: any) {
        console.error('[Login] Error:', err);
        if (err?.message?.includes('fetch') || err?.message?.includes('network')) {
          toast.error('Connection Error', {
            description: 'Unable to connect to auth server. Please try again later.',
          });
        } else {
          toast.error('Login Failed', {
            description: err?.message || 'Something went wrong. Please try again.',
          });
        }
      }
      setSubmitting(false);
    },
  });

  return (
    <View style={styles.container}>
      {/* Background video — same live HLS stream as the landing hero. */}
      <video
        ref={videoRef}
        // eslint-disable-next-line jsx-a11y/media-has-caption
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        style={styles.backgroundVideo as React.CSSProperties}
      />
      {/* Scrim — matches the landing hero gradient over the video. */}
      <View style={styles.overlay} />

      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your account to continue</Text>
          </View>

          <View style={styles.fields}>
            <FormInput
              form={form}
              name="email"
              label="Email"
              labelClassName="text-white"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              validators={{
                onChange: ({ value }: any) => {
                  if (!value) return 'Email is required';
                  if (!value.includes('@')) return 'Please enter a valid email';
                  return undefined;
                },
              }}
            />
            <FormInput
              form={form}
              name="password"
              label="Password"
              labelClassName="text-white"
              placeholder="Enter your password"
              secureTextEntry
              validators={{
                onChange: ({ value }: any) => {
                  if (!value) return 'Password is required';
                  if (value.length < 8) return 'Password must be at least 8 characters';
                  return undefined;
                },
              }}
            />

            <View style={styles.forgotRow}>
              <Pressable onPress={() => router.push('/auth/forgot-password')}>
                <Text style={[styles.link, { color: P }]}>Forgot password?</Text>
              </Pressable>
            </View>

            <Button onPress={form.handleSubmit} disabled={isSubmitting} loading={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.or}>Or</Text>
              <View style={styles.divider} />
            </View>

            <Pressable
              onPress={async () => {
                try {
                  await (signIn as any).social({
                    provider: 'google',
                    callbackURL: '/auth/social-callback',
                  });
                } catch (err: any) {
                  toast.error('Google sign-in failed', {
                    description: err?.message || 'Please try again or use email.',
                  });
                }
              }}
              accessibilityRole="button"
              style={styles.googleButton}
            >
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </Pressable>

            <View style={styles.signupRow}>
              <Text style={styles.muted}>Don't have an account?</Text>
              <Pressable onPress={() => router.push('/auth/signup')}>
                <Text style={[styles.link, styles.signupLink, { color: P }]}>Sign up</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: LANDING_COLORS.bg, minHeight: '100vh' as unknown as number },
  flex: { flex: 1 },
  backgroundVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  } as unknown as Record<string, unknown>,
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({
      backgroundImage:
        'linear-gradient(180deg, rgba(2,3,10,0.55) 0%, rgba(20,6,40,0.45) 40%, rgba(2,3,10,0.82) 100%)',
    } as any) as object),
  },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 48 },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: 20,
    // Readable scrim over the (variably-bright) background video.
    backgroundColor: 'rgba(2,3,10,0.62)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 28,
    paddingVertical: 32,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as any) as object),
  },
  header: { alignItems: 'center', marginVertical: 24 },
  title: { color: '#fff', fontSize: 30, lineHeight: 36, fontWeight: '800' },
  subtitle: { color: 'rgba(255,255,255,0.7)', fontSize: 15, marginTop: 12 },
  fields: { gap: 16 },
  forgotRow: { alignItems: 'flex-end' },
  link: { fontSize: 14, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.15)' },
  googleButton: {
    height: 48,
    borderRadius: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonText: { color: '#1f1f1f', fontSize: 15, fontWeight: '700' },
  or: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  signupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  muted: { color: 'rgba(255,255,255,0.7)' },
  signupLink: { fontWeight: '700' },
});
