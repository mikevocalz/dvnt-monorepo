import { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRouter } from 'solito/navigation';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { authClient, resendVerificationEmail } from '../../../lib/auth-client';
import { Check, Mail, AlertCircle } from 'lucide-react';
import { AUTH_PRIMARY_COLOR as P, AUTH_DESTRUCTIVE_COLOR as D } from './AuthScreens.shared';

type Status = 'checking' | 'success' | 'error' | 'waiting';

export function VerifyEmailScreen() {
  const [status, setStatus] = useState<Status>('checking');
  // Next app uses Solito/Next routing (no TanStack RouterProvider).
  const router = useRouter();
  const navigate = ({ to }: { to: string }) => router.push(to);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const verify = async () => {
      if (token) {
        try {
          const { data: session } = await authClient.getSession() as any;
          if (session?.user?.emailVerified) {
            setStatus('success');
            toast.success('Email verified', { description: 'Your email has been confirmed' });
            setTimeout(() => navigate({ to: '/story' }), 2000);
            return;
          }
        } catch {}
        setStatus('error');
      } else {
        setStatus('waiting');
      }
    };
    void verify();
  }, []);

  const handleResend = async () => {
    try {
      const { data: session } = await authClient.getSession() as any;
      if (!session?.user?.email) { toast.error('No active session found'); return; }
      const response = await resendVerificationEmail(session.user.email);
      if ((response as any)?.error) throw new Error((response as any).error.message);
      toast.success('Email sent', { description: 'Check your inbox for the verification link' });
    } catch (err: any) {
      toast.error('Error', { description: err?.message || 'Failed to resend verification email' });
    }
  };

  if (status === 'checking') return <View style={{ flex: 1, backgroundColor: '#02030A', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 15 }}>Verifying your email...</Text></View>;

  if (status === 'success') return (
    <View style={{ flex: 1, backgroundColor: '#02030A', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32 }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(62,164,229,0.12)', alignItems: 'center', justifyContent: 'center' }}><Check size={40} color={P} /></View>
      <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center' }}>Email Verified!</Text>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center' }}>Your email has been confirmed. Redirecting...</Text>
    </View>
  );

  if (status === 'error') return (
    <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 24, alignItems: 'center' }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(240,82,82,0.12)', alignItems: 'center', justifyContent: 'center' }}><AlertCircle size={40} color={D} /></View>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center' }}>Verification Failed</Text>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center' }}>This verification link is invalid or expired.</Text>
        <View style={{ width: '100%', gap: 12 }}>
          <Button onPress={handleResend}>Resend Verification Email</Button>
          <Button variant="secondary" onPress={() => navigate({ to: '/auth/login' })}>Back to Login</Button>
        </View>
      </View>
    </ScrollView>
  );

  return (
    <ScrollView style={{ minHeight: '100%' as any, backgroundColor: '#02030A' }} contentContainerStyle={{ minHeight: 720, justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center', gap: 24, alignItems: 'center' }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(62,164,229,0.12)', alignItems: 'center', justifyContent: 'center' }}><Mail size={40} color={P} /></View>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center' }}>Check Your Email</Text>
        <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>We've sent a verification link to your email. Tap it to confirm your account.</Text>
        <View style={{ width: '100%', gap: 12 }}>
          <Button onPress={handleResend}>Resend Verification Email</Button>
          <Button variant="secondary" onPress={() => navigate({ to: '/auth/login' })}>Back to Login</Button>
        </View>
      </View>
    </ScrollView>
  );
}
