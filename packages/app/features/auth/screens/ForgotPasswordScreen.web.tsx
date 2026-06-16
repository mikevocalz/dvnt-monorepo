import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { FormInput } from '../../../components/form';
import { requestPasswordReset } from '../../../lib/auth-client';
import { Mail, ShieldCheck, LifeBuoy, ArrowLeft } from 'lucide-react';
import { AUTH_PRIMARY_COLOR as P, AUTH_SUPPORT_EMAIL } from './AuthScreens.shared';

export function ForgotPasswordScreen() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      try {
        const response = await requestPasswordReset(value.email.trim());
        if ((response as any)?.error) { toast.error('Recovery failed', { description: (response as any).error.message || 'Could not send recovery email.' }); return; }
        setSubmittedEmail(value.email.trim());
        toast.success('Check your email', { description: 'We sent a secure password reset link.' });
      } catch (err: any) {
        toast.error('Recovery failed', { description: err?.message || 'Could not send recovery email.' });
      } finally { setIsSubmitting(false); }
    },
  });

  if (submittedEmail) {
    return (
      <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 24, alignItems: 'center' }}>
          <View style={{ width: 80, height: 80, borderRadius: 24, backgroundColor: 'rgba(62,164,229,0.12)', alignItems: 'center', justifyContent: 'center' }}>
            <Mail size={36} color={P} />
          </View>
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' }}>Check your email</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>We sent a reset link to {submittedEmail}.</Text>
          <View style={{ width: '100%', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}><ShieldCheck size={18} color={P} /><Text style={{ flex: 1, color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 20 }}>Recovery links expire. Check spam or request another below.</Text></View>
            <View style={{ flexDirection: 'row', gap: 10 }}><LifeBuoy size={18} color={P} /><Text style={{ flex: 1, color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 20 }}>If you no longer have email access, contact {AUTH_SUPPORT_EMAIL}.</Text></View>
          </View>
          <View style={{ width: '100%', gap: 12 }}>
            <Button onPress={() => setSubmittedEmail(null)}>Send another link</Button>
            <Button variant="secondary" onPress={() => navigate({ to: '/auth/login' })}>Back to sign in</Button>
            <Pressable onPress={() => { window.location.href = `mailto:${AUTH_SUPPORT_EMAIL}?subject=DVNT%20Account%20Recovery`; }} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ color: P, fontSize: 13, fontWeight: '600' }}>Need help? Contact support</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 28 }}>
        <Pressable onPress={() => navigate({ to: '/auth/login' })} style={{ alignSelf: 'flex-start' }}><ArrowLeft size={24} color="#fff" /></Pressable>
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900' }}>Recover your account</Text>
          <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 15, lineHeight: 23 }}>Use the email attached to your DVNT account. We'll send a secure reset link.</Text>
        </View>
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: 16 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}><ShieldCheck size={18} color={P} /><Text style={{ flex: 1, color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 20 }}>DVNT recovery is email-based. Other recovery methods are part of a future phase.</Text></View>
        </View>
        <View style={{ gap: 14 }}>
          <FormInput form={form} name="email" label="Email" placeholder="you@example.com" autoCapitalize="none" validators={{ onChange: ({ value }: any) => (!value ? 'Email is required' : !value.includes('@') ? 'Valid email required' : undefined) }} />
          <Button onPress={form.handleSubmit} disabled={isSubmitting} loading={isSubmitting}>{isSubmitting ? 'Sending link...' : 'Send recovery link'}</Button>
        </View>
      </View>
    </ScrollView>
  );
}
