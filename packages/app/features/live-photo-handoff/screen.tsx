import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { livePhotoHandoffApi } from '@dvnt/app/lib/api/live-photo-handoff';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import { getAuthToken } from '@dvnt/app/lib/auth-client';
import { uploadToServer } from '@dvnt/app/lib/server-upload';
import { scheduleWebUpload } from '@dvnt/app/lib/media/web-upload-rate';
import { uploadNativePairs } from './upload-native-pairs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default function LivePhotoHandoffScreen() {
  const params = useLocalSearchParams<{ handoff?: string; draft?: string }>();
  const id = typeof params.handoff === 'string' ? params.handoff : '';
  const draft = typeof params.draft === 'string' ? params.draft : '';
  const userId = useAuthStore(state => state.user?.id);
  const insets = useSafeAreaInsets();
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('Checking your browser draft…');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const selected = useRef<ImagePicker.ImagePickerAsset[]>([]);
  const uploaded = useRef(new Map<string, number>());
  const lock = useRef(false);
  const expiry = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const run = ++generation.current;
    lock.current = false;
    setBusy(false);
    selected.current = [];
    uploaded.current.clear();
    setState('loading');
    if (!UUID.test(id) || !UUID.test(draft)) {
      setState('invalid'); setMessage('This handoff link is invalid. Return to your original browser tab.');
      return () => { mounted.current = false; generation.current++; };
    }
    livePhotoHandoffApi.status(id, draft).then(data => {
      if (!mounted.current || generation.current !== run) return;
      expiry.current = Date.parse(data.expiresAt);
      setState(data.state);
      setMessage(data.state === 'pending' ? 'Choose Live Photos to send their original photo and motion back to your browser draft.' : 'This handoff is already ' + data.state + '. Return to your original browser tab.');
    }).catch(error => {
      if (!mounted.current || generation.current !== run) return;
      setState('error'); setMessage(error instanceof Error ? error.message : 'Unable to open handoff. Sign in with the same account as your browser.');
    });
    return () => { mounted.current = false; generation.current++; };
  }, [id, draft, userId]);

  async function send(retry: boolean) {
    if (lock.current || state !== 'pending' || Platform.OS !== 'ios') return;
    lock.current = true; setBusy(true);
    const run = generation.current;
    const owner = userId;
    const assertActive = () => {
      if (!mounted.current || generation.current !== run || !owner || useAuthStore.getState().user?.id !== owner) throw new Error('Your sign-in or handoff changed. Return to the original browser tab and try again.');
      if (!Number.isFinite(expiry.current) || Date.now() >= expiry.current) throw new Error('This handoff expired. Start again from your browser draft.');
    };
    try {
      assertActive();
      const token = await getAuthToken(); assertActive();
      if (!token) throw new Error('Sign in with the same account as your browser.');
      // Reconcile an uncertain completion before retrying any upload.
      const current = await livePhotoHandoffApi.status(id, draft); assertActive();
      if (current.state !== 'pending') {
        setState(current.state);
        setMessage('This handoff is ' + current.state + '. Return to your original browser tab.');
        return;
      }
      if (current.maxCount < 1 || current.maxCount > 10) throw new Error('Invalid handoff size. Start again from your browser draft.');
      expiry.current = Date.parse(current.expiresAt); assertActive();
      if (!retry) {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['livePhotos'], allowsMultipleSelection: true, selectionLimit: current.maxCount, allowsEditing: false, quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current });
        assertActive();
        if (result.canceled) return;
        selected.current = result.assets;
        uploaded.current.clear();
      }
      setMessage('Uploading original Live Photos. Keep DVNT open…');
      const pairs = await uploadNativePairs(selected.current, current.maxCount, {
        assertActive, completedUploads: uploaded.current,
        upload: async (uri, mimeType) => {
          const response = await scheduleWebUpload(async () => {
            assertActive();
            const result = await uploadToServer(uri, 'posts', undefined, { mimeType, expectedAuthToken: token });
            assertActive();
            return { data: { ok: result.success, error: result.error }, result };
          }, text => { if (mounted.current && generation.current === run) setMessage(text.replace('tab', 'app')); });
          assertActive(); return response.result;
        },
      });
      assertActive();
      await livePhotoHandoffApi.complete(id, draft, pairs);
      assertActive();
      setState('ready'); setMessage('Live Photos are ready in your browser draft. Nothing has been posted.');
    } catch (error) {
      if (mounted.current && generation.current === run) setMessage(error instanceof Error ? error.message : 'Upload failed. Your browser draft is unchanged.');
    } finally {
      if (mounted.current && generation.current === run) { lock.current = false; setBusy(false); }
    }
  }

  async function cancel() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const run = generation.current;
    try {
      await livePhotoHandoffApi.cancel(id, draft);
      if (mounted.current && generation.current === run) { setState('cancelled'); setMessage('Cancelled. Your original browser draft is unchanged.'); }
    } catch (error) {
      if (mounted.current && generation.current === run) setMessage(error instanceof Error ? error.message : 'Could not confirm cancellation. Return to your browser tab to check.');
    } finally { if (mounted.current && generation.current === run) { lock.current = false; setBusy(false); } }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: '#111' }} contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, gap: 20 }}>
    <Text accessibilityRole="header" style={{ color: '#fff', fontSize: 26, fontWeight: '700' }}>Live Photos for your browser draft</Text>
    <Text style={{ color: '#eee', fontSize: 16 }}>{message}</Text>
    {busy && <ActivityIndicator accessibilityLabel="Uploading Live Photos" />}
    {Platform.OS !== 'ios' && <Text style={{ color: '#fff' }}>Open this handoff in DVNT on your iPhone to select Apple Live Photos.</Text>}
    {state === 'pending' && Platform.OS === 'ios' && <View style={{ gap: 16 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send(false)} style={{ padding: 16, backgroundColor: '#c7f66b', borderRadius: 12, opacity: busy ? 0.5 : 1 }}><Text>Select Live Photos</Text></Pressable>
      {!!selected.current.length && <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send(true)}><Text style={{ color: '#c7f66b' }}>Retry selected Live Photos</Text></Pressable>}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void cancel()}><Text style={{ color: '#fff' }}>Cancel handoff</Text></Pressable>
    </View>}
    <Text style={{ color: '#bbb' }}>Return to the original browser tab to continue your draft and choose when to post. Opening another browser window may not return you to that tab.</Text>
  </ScrollView>;
}
