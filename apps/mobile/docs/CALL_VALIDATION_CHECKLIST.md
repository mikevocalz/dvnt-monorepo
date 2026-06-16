# 📱 2-Device Call Validation Checklist

## Prerequisites

- [ ] Both devices on **production build** (OTA-updated to latest)
- [ ] Both devices have **mic + camera permissions** granted
- [ ] Both devices **logged into different accounts**
- [ ] Both devices on **stable WiFi** (not cellular to avoid cost)
- [ ] **DEV HUD enabled** (tap HUD overlay to expand/collapse)

---

## Test 1: Audio Call - NO AUDIO OUTPUT Fix

**Phone A** (Caller):
1. [ ] Start audio call to Phone B
2. [ ] Verify CallKit/ConnectionService shows "Calling…"
3. [ ] DEV HUD: Check `audioSess=ON` and `CK=ACT` (iOS) or `audioSess=ON` (Android)
4. [ ] DEV HUD: Check `micStream=Y | lAudTrk=1` AFTER CallKit activation
5. [ ] **Speak into Phone A** → verify you can hear yourself clearly on Phone B

**Phone B** (Callee):
1. [ ] Answer incoming call
2. [ ] DEV HUD: Check `audioSess=ON` and `CK=ACT` (iOS)
3. [ ] DEV HUD: Check `micStream=Y | lAudTrk=1` AFTER answer
4. [ ] DEV HUD: Check `rem=1 | rAud=1` (remote peer joined + has audio)
5. [ ] DEV HUD: Check `rAudStrm=Y | rAudTrk=Y | ready=live | enabled=Y`
6. [ ] **Speak into Phone B** → verify you can hear yourself clearly on Phone A
7. [ ] **Have conversation for 30s** → verify audio is continuous, no dropouts

**Expected Result**: ✅ **Both sides hear each other clearly**

**Failure Symptoms**:
- ❌ `CK=WAIT` on iOS → CallKit hasn't activated yet, mic track created on dead session
- ❌ `micStream=N` or `lAudTrk=0` → mic not started
- ❌ `rAudStrm=N` or `rAudTrk=N` → remote audio track not received
- ❌ `ready=ended` or `enabled=N` → track exists but not playing

---

## Test 2: Video Call - REMOTE/LOCAL VIDEO Fix

**Phone A** (Caller):
1. [ ] Start **video** call to Phone B
2. [ ] DEV HUD: Check `lVid=Y` (local video on)
3. [ ] **Phone A Screen**: Verify you see **YOUR OWN CAMERA** in small bubble (top-right)
4. [ ] **Phone A Screen**: Verify main stage shows **avatar + "Calling…"** (remote not joined yet)
5. [ ] Wait for Phone B to answer

**Phone B** (Callee):
1. [ ] Answer video call
2. [ ] DEV HUD: Check `lVid=Y | rVid=Y` (both have video)
3. [ ] DEV HUD: Check `rem=1 | rVid=1`
4. [ ] DEV HUD: Check `rVidStrm=Y | rVidTrk=Y | ready=live | enabled=Y`
5. [ ] **Phone B Screen**: Verify main stage shows **PHONE A'S FACE FULLSCREEN**
6. [ ] **Phone B Screen**: Verify small bubble shows **YOUR OWN CAMERA** (not Phone A's)

**Phone A** (After Phone B Answers):
1. [ ] DEV HUD: Check `rem=1 | rVid=1` (remote peer joined with video)
2. [ ] DEV HUD: Check `rVidStrm=Y | rVidTrk=Y`
3. [ ] **Phone A Screen**: Verify main stage shows **PHONE B'S FACE FULLSCREEN**
4. [ ] **Phone A Screen**: Verify small bubble shows **YOUR OWN CAMERA** (not Phone B's)

**Expected Result**: ✅ **FaceTime-style reversed layout**:
- **Phone A sees**: Phone B fullscreen + own camera bubble
- **Phone B sees**: Phone A fullscreen + own camera bubble
- **NOT**: Both phones showing same feed or both showing own camera fullscreen

**Failure Symptoms**:
- ❌ `rVidStrm=N` even after `rem=1` → remote track.stream is null (async negotiation pending)
- ❌ `ready=ended` or `enabled=N` → track exists but not active
- ❌ Both phones show avatar → remote track never populated (store bailout issue)
- ❌ Both phones show same face → local/remote mapping broken

---

## Test 3: Call Stability - NO DROPPING Fix

**Both Phones**:
1. [ ] Stay on video call for **2 minutes**
2. [ ] DEV HUD: Check `rem=1` stays stable (no drops to `rem=0`)
3. [ ] DEV HUD: Check `rAudStrm=Y` and `rVidStrm=Y` stay `Y` (not flapping)
4. [ ] Toggle mute ON → **speak** → other side should **NOT hear** you
5. [ ] Toggle mute OFF → **speak** → other side should **hear** you
6. [ ] Toggle video OFF → other side sees **avatar** (not your camera)
7. [ ] Toggle video ON → other side sees **your face** again
8. [ ] **Lock screen** (iOS) or **go to home** (Android)
9. [ ] **Unlock** and return to call → verify still connected (`rem=1`)
10. [ ] End call → both phones show "Call ended" summary

**Expected Result**: ✅ **Call stays connected for full duration**

**Failure Symptoms**:
- ❌ Call drops after 1-2 mins → likely token expiry (Fishjam tokens expire)
- ❌ `rem` flaps between 0 and 1 → reconnection loop (no backoff)
- ❌ Call ends when locking screen → PiP not working / cleanup fired too early
- ❌ "Call ended" flashes twice → duplicate cleanup (leaveCall + external end effect)

---

## Test 4: Incoming Call - RINGING Fix

**Phone A** (Idle):
1. [ ] App in **foreground**, idle

**Phone B**:
1. [ ] Start call to Phone A
2. [ ] Wait **2 seconds**

**Phone A**:
1. [ ] Verify **native incoming call UI appears** (CallKit on iOS, ConnectionService on Android)
2. [ ] Answer call
3. [ ] Verify navigates to call screen and connects

**Expected Result**: ✅ **Native incoming call UI appears reliably**

**Failure Symptoms**:
- ❌ No incoming call UI → `showIncomingCall` failed (CallKeep setup race)
- ❌ Incoming call appears on 2nd try but not 1st → no retry logic on error

---

## Test 5: Audio → Video Escalation

**Phone A & B** (Both on audio call):
1. [ ] Phone A: Tap **video button** to enable camera
2. [ ] **Phone A Screen**: Verify your camera bubble appears
3. [ ] **Phone B Screen**: Verify Phone A's face appears fullscreen
4. [ ] Phone B: Tap **video button** to enable camera
5. [ ] **Phone B Screen**: Verify your camera bubble appears
6. [ ] **Phone A Screen**: Verify Phone B's face appears fullscreen

**Expected Result**: ✅ **Both sides now on video call**

---

## Test 6: Mute/Speaker Toggle

**Both Phones** (On call):
1. [ ] Toggle **speaker** ON → DEV HUD: `spk=Y | hwSpk=Y`
2. [ ] Toggle **speaker** OFF → DEV HUD: `spk=N | hwSpk=N`
3. [ ] Toggle **mute** ON → DEV HUD: `mic=OFF | hwMute=Y`
4. [ ] Toggle **mute** OFF → DEV HUD: `mic=ON | hwMute=N`
5. [ ] Other side: Verify they **hear** you when unmuted, **silence** when muted

**Expected Result**: ✅ **Controls work instantly, no lag**

**Failure Symptoms**:
- ❌ Mute toggles back immediately → feedback loop (didPerformSetMutedCallAction echo)
- ❌ Speaker state mismatch → `spk` vs `hwSpk` out of sync

---

## Test 7: Camera Switch

**Both Phones** (On video call):
1. [ ] Tap **camera switch** button
2. [ ] DEV HUD: Verify local camera feed switches (front ↔ back)
3. [ ] Other side: Verify they see the switched camera feed

**Expected Result**: ✅ **Camera switches smoothly**

---

## Test 8: Crash Recovery

**Phone A** (On call):
1. [ ] Force-quit app (swipe up from recent apps)
2. [ ] Reopen app

**Phone B**:
1. [ ] Verify call auto-ended after ~5s (peer left)
2. [ ] Verify no orphaned CallKit UI

**Expected Result**: ✅ **No ghost calls, clean recovery**

---

## Success Criteria

All tests pass with:
- ✅ Audio flows both directions
- ✅ Video shows FaceTime-style reversed layout
- ✅ Calls stay connected for 2+ minutes
- ✅ Incoming calls ring reliably
- ✅ Controls work instantly
- ✅ No crashes, no ghost calls

---

## Debugging Failed Tests

### No Audio

```bash
# Check CallTrace logs (last 50 events)
CT.dump().slice(-50).forEach(e => console.log(e))

# Look for:
# - "mic_start_failed" → permission denied or startMicrophone error
# - "activateFromCallKit" → should fire on iOS before mic starts
# - "audioSession_ios_waiting_for_callkit" → mic deferred
# - "invoking_pending_mic_start" → mic actually started
```

### Video Not Showing

```bash
# Check remote peer tracks
remotePeers[0].cameraTrack?.stream  // should be MediaStream, not null
remotePeers[0].cameraTrack?.track  // should be MediaStreamTrack
remotePeers[0].cameraTrack?.track?.readyState  // should be "live"

# Check if store bailout blocked update
# Look for: participants array updated but UI didn't re-render
```

### Call Dropping

```bash
# Check for duplicate cleanup
CT.dump().filter(e => e.event.includes('leaveRoom'))
# Should see ONE leaveRoom per call end, not two

# Check for token expiry
# Look for: disconnect ~60-120s after join → token expired
```

---

## Post-Validation

After all tests pass:
1. [ ] Push fixes to `main`
2. [ ] Deploy OTA update: `npx eas-cli update --branch production --platform ios --message "fix: calling SEV-0 fixes - audio output + video rendering + stability"`
3. [ ] TestFlight users: Force-close app twice (download → apply OTA)
4. [ ] Revalidate with 2 TestFlight devices
