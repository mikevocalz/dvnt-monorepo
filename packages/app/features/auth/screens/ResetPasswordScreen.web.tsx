import { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useForm } from '@tanstack/react-form';
import { useRouter } from 'solito/navigation';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { FormInput } from '../../../components/form';
import { authClient, submitPasswordReset } from '../../../lib/auth-client';
import { Check, AlertCircle, ShieldCheck, ArrowLeft } from 'lucide-react';
import { AUTH_PRIMARY_COLOR as P, AUTH_DESTRUCTIVE_COLOR as D } from './AuthScreens.shared';

type Status = 'checking' | 'ready' | 'success' | 'invalid';

export function ResetPasswordScreen() {
  const [status, setStatus] = useState<Status>('checking');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Next app uses Solito/Next routing (no TanStack RouterProvider).
  const router = useRouter();
  const navigate = ({ to }: { to: string }) => router.push(to);

  useEffect(() => {
    authClient.getSession().then(({ data }: any) => setStatus(data ? 'ready' : 'invalid')).catch(() => setStatus('invalid'));
  }, []);

  const form = useForm({
    defaultValues: { password: '', confirmPassword: '' },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      try {
        const response = await submitPasswordReset(value.password);
        if ((response as any)?.error) { toast.error('Reset failed', { description: (response as any).error.message || 'Could not update password.' }); return; }
        setStatus('success');
        toast.success('Password updated', { description: 'Your new password is set.' });
        setTimeout(() => navigate({ to: '/auth/login' }), 1800);
      } catch (err: any) {
        toast.error('Reset failed', { description: err?.message || 'Could not update password.' });
      } finally { setIsSubmitting(false); }
    },
  });

  if (status === 'checking') return <View style={{ flex: 1, backgroundColor: '#02030A', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15 }}>Validating your recovery link…</Text></View>;

  if (status === 'success') return (
    <View style={{ flex: 1, backgroundColor: '#02030A', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }}>
      <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(62,164,229,0.12)', alignItems: 'center', justifyContent: 'center' }}><Check size={36} color={P} /></View>
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' }}>Password updated</Text>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center' }}>Heading back to sign in now.</Text>
    </View>
  );

  if (status === 'invalid') return (
    <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 24, alignItems: 'center' }}>
        <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(240,82,82,0.12)', alignItems: 'center', justifyContent: 'center' }}><AlertCircle size={36} color={D} /></View>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' }}>This link is no longer valid</Text>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>Recovery links expire. Request a fresh email to continue.</Text>
        <View style={{ width: '100%', gap: 12 }}>
          <Button onPress={() => navigate({ to: '/auth/forgot-password' })}>Request a new recovery link</Button>
          <Button variant="secondary" onPress={() => navigate({ to: '/auth/login' })}>Back to sign in</Button>
        </View>
      </View>
    </ScrollView>
  );

  return (
    <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 28 }}>
        <Pressable onPress={() => navigate({ to: '/auth/login' })} style={{ alignSelf: 'flex-start' }}><ArrowLeft size={24} color="#fff" /></Pressable>
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>Create a new password</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 23 }}>Choose a strong password you haven't used for DVNT before.</Text>
        </View>
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 16 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}><ShieldCheck size={18} color={P} /><Text style={{ flex: 1, color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 20 }}>Saving here will replace your old password immediately.</Text></View>
        </View>
        <View style={{ gap: 14 }}>
          <FormInput form={form} name="password" label="New Password" placeholder="Enter new password" secureTextEntry validators={{ onChange: ({ value }: any) => (!value ? 'Password is required' : value.length < 8 ? 'At least 8 characters' : undefined) }} />
          <FormInput form={form} name="confirmPassword" label="Confirm Password" placeholder="Re-enter new password" secureTextEntry validators={{ onChangeListenTo: ['password'], onChange: ({ value, fieldApi }: any) => { const pw = fieldApi.form.getFieldValue('password'); return !value ? 'Please confirm' : value !== pw ? 'Passwords do not match' : undefined; } }} />
          <Button onPress={form.handleSubmit} disabled={isSubmitting} loading={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save new password'}</Button>
        </View>
      </View>
    </ScrollView>
  );
}
