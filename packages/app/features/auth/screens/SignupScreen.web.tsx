import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useForm } from '@tanstack/react-form';
import { useRouter } from 'solito/navigation';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { FormInput } from '../../../components/form';
import { signUp } from '../../../lib/auth-client';
import { useAuthStore } from '../../../lib/stores/auth-store';
import { syncAuthUser } from '../../../lib/api/privileged';
import { auth } from '../../../lib/api/auth';
import { Check, Mail } from 'lucide-react';
import { AUTH_PRIMARY_COLOR as P } from './AuthScreens.shared';

const STEPS = ['User Info', 'Terms', 'Verification'] as const;

export function SignupScreen() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const { setUser } = useAuthStore();
  // Next app uses Solito/Next routing (no TanStack RouterProvider).
  const router = useRouter();
  const navigate = ({ to }: { to: string }) => router.push(to);

  const form = useForm({
    defaultValues: { email: '', username: '', password: '' },
    onSubmit: async ({ value }) => {
      if (activeStep === 0) { setActiveStep(1); return; }
      if (activeStep === 1) {
        if (!agreedToTerms) { toast.error('Please accept the terms to continue'); return; }
        setActiveStep(2);
        setIsSubmitting(true);
        try {
          const { data, error } = await signUp.email({ email: value.email, password: value.password, name: value.username });
          if (error) throw new Error((error as any).message || 'Signup failed');
          if (data?.user) {
            let profile: any;
            try { profile = await syncAuthUser(); } catch { profile = await auth.getProfile(data.user.id, data.user.email); }
            if (profile) setUser({ id: profile.id, email: profile.email, username: profile.username, name: profile.name, avatar: profile.avatar || '', bio: profile.bio || '', website: (profile as any).website || '', location: profile.location || '', hashtags: (profile as any).hashtags || [], isVerified: profile.isVerified, postsCount: profile.postsCount, followersCount: profile.followersCount, followingCount: profile.followingCount });
            navigate({ to: '/auth/verify-email' });
          }
        } catch (err: any) {
          toast.error('Signup failed', { description: err?.message || 'Something went wrong.' });
          setActiveStep(1);
        }
        setIsSubmitting(false);
      }
    },
  });

  return (
    <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
      <View style={{ position: 'absolute', width: 420, height: 420, borderRadius: 210, backgroundColor: 'rgba(62,164,229,0.18)', top: -140, right: -140, filter: 'blur(56px)' } as any} />
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', padding: 28 }}>
        <Text style={{ color: 'rgba(255,255,255,0.50)', fontSize: 11, fontWeight: '900', letterSpacing: 3, textTransform: 'uppercase' }}>DVNT.APP</Text>
        <Text style={{ marginTop: 14, color: '#fff', fontSize: 36, lineHeight: 40, fontWeight: '900' }}>Create your account</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
          {STEPS.map((label, i) => {
            const isComplete = i < activeStep;
            const isActive = i === activeStep;
            return (
              <View key={label} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: isComplete || isActive ? P : 'rgba(255,255,255,0.25)', backgroundColor: isComplete ? P : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {isComplete ? <Check size={14} color="#fff" /> : <Text style={{ color: isActive ? P : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '900' }}>{i + 1}</Text>}
                </View>
                <Text style={{ color: isActive || isComplete ? P : 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
              </View>
            );
          })}
        </View>
        {activeStep === 0 && (
          <View style={{ marginTop: 24, gap: 14 }}>
            <FormInput form={form} name="email" label="Email" placeholder="you@example.com" autoCapitalize="none" validators={{ onChange: ({ value }: any) => (!value ? 'Email is required' : !value.includes('@') ? 'Valid email required' : undefined) }} />
            <FormInput form={form} name="username" label="Username" placeholder="yourname" autoCapitalize="none" validators={{ onChange: ({ value }: any) => (!value ? 'Username is required' : undefined) }} />
            <FormInput form={form} name="password" label="Password" placeholder="Create a password" secureTextEntry validators={{ onChange: ({ value }: any) => (!value ? 'Password is required' : value.length < 8 ? 'At least 8 characters' : undefined) }} />
          </View>
        )}
        {activeStep === 1 && (
          <View style={{ marginTop: 24, gap: 16 }}>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 21 }}>By continuing you agree to DVNT's Terms of Service and Privacy Policy.</Text>
            <Pressable onPress={() => setAgreedToTerms(!agreedToTerms)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: agreedToTerms ? P : 'rgba(255,255,255,0.3)', backgroundColor: agreedToTerms ? P : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {agreedToTerms && <Check size={12} color="#fff" />}
              </View>
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>I agree to the Terms and Privacy Policy</Text>
            </Pressable>
          </View>
        )}
        {activeStep === 2 && (
          <View style={{ marginTop: 24, alignItems: 'center', gap: 12 }}>
            <Mail size={40} color={P} />
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' }}>Check your email</Text>
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center' }}>We sent a verification link. Tap it to confirm your account.</Text>
          </View>
        )}
        <View style={{ marginTop: 24, gap: 12 }}>
          {activeStep < 2 && <Button onPress={form.handleSubmit} disabled={isSubmitting} loading={isSubmitting}>{activeStep === 0 ? 'Continue' : 'Create account'}</Button>}
          {activeStep === 2 && <Button onPress={() => navigate({ to: '/auth/login' })}>Go to sign in</Button>}
        </View>
        <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14 }}>Already have an account?</Text>
          <Pressable onPress={() => navigate({ to: '/auth/login' })}>
            <Text style={{ color: P, fontSize: 14, fontWeight: '700' }}> Sign in</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}
