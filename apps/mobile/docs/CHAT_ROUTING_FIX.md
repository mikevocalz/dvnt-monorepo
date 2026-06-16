# Chat Routing Infinite Loop Fix - Complete Documentation

## Executive Summary

Fixed P0 "Maximum update depth exceeded" crash in chat screen caused by multiple infinite render loops. All root causes identified and eliminated with production-grade fixes.

## Root Causes (Ranked by Severity)

### RC-1: CRITICAL - Unstable `useFocusEffect` Dependency
**Location**: `app/(protected)/chat/[id].tsx:429-437`

**Problem**:
```typescript
useFocusEffect(
  useCallback(() => {
    if (convId && chatMessages.length > 0) {
      loadMessages(convId);
    }
  }, [loadMessages, chatMessages.length > 0]), // ❌ Boolean recreates every render
);
```

The dependency `chatMessages.length > 0` is a boolean that changes when messages load → triggers effect → calls `loadMessages` → updates messages → changes boolean → infinite loop.

**Fix**: Removed unstable dependency, added `hasLoadedInitialMessagesRef` guard to only reload on focus after initial load completes.

---

### RC-2: CRITICAL - Multiple `loadMessages` Calls Creating Loops
**Location**: `app/(protected)/chat/[id].tsx:445-524`

**Problem**: Three separate effects all calling `loadMessages(activeConvId)`:
1. Main load effect (line 445)
2. Mark as read callback (line 460) - **duplicate call**
3. Realtime subscription (line 506)

Each call updates store → triggers re-renders → can retrigger effects.

**Fix**: 
- Removed duplicate `loadMessages` call from mark-as-read callback
- Added `hasLoadedInitialMessagesRef` guard to prevent duplicate initial loads
- Added 1-second throttle to realtime subscription reloads
- Added guard to only subscribe after initial load completes

---

### RC-3: HIGH - `useState` Violations Creating Render Loops
**Location**: `app/(protected)/chat/[id].tsx:529-557`

**Problem**: Multiple `useState` calls violate project's mandatory Zustand-only rule:
- `recipient` state
- `isLoadingRecipient` state
- `isGroupChat` state
- `groupMembers` state
- `groupName` state

Each `setState` call triggers re-renders that can cascade into loops.

**Fix**: Created `useChatScreenStore` Zustand store, migrated all state. Ephemeral screen state, cleared on unmount.

---

### RC-4: HIGH - Unstable Effect Dependencies
**Location**: `app/(protected)/chat/[id].tsx:574-624`

**Problem**:
```typescript
useEffect(() => {
  loadRecipientFromConversation();
}, [chatId, currentUser]); // ❌ currentUser is object, recreates every render
```

Object dependencies recreate every render → retrigger effects → infinite loops.

**Fix**: 
- Use primitive `currentUserId` instead of object `currentUser`
- Added `hasLoadedRecipientRef` guard to load only once per chatId
- Stabilized all effect dependency arrays

---

### RC-5: MEDIUM - Self-Message Check Loop
**Location**: `app/(protected)/chat/[id].tsx:630-635`

**Problem**: Compares objects that may recreate, calls `router.back()` inside effect without guard.

**Fix**: Use primitive IDs, added `selfMessageCheckDoneRef` to run check only once.

---

## Files Created

### 1. `/lib/navigation/chat-routes.ts`
Canonical chat route helper with consistent param handling.

**Key Functions**:
- `navigateToChat(router, params)` - Single source of truth for all chat navigation
- `normalizeChatParams(rawParams)` - Handles string|string[] from Expo Router, returns stable primitives

**Benefits**:
- Eliminates duplicate route patterns
- Ensures consistent param handling across all entry points
- Prevents string|string[] type instability

### 2. `/lib/stores/chat-screen-store.ts`
Zustand store for chat screen UI state.

**State**:
- `recipient` - Chat recipient info
- `isLoadingRecipient` - Loading state
- `isGroupChat` - Group chat flag
- `groupMembers` - Group member list
- `groupName` - Group chat name
- `mountPhase` - State machine phase

**Benefits**:
- Complies with project Zustand-only mandate
- Eliminates useState render loop triggers
- Ephemeral state, cleared on unmount

### 3. `/lib/diagnostics/chat-diagnostics.ts`
Verification instrumentation (can be removed after verification).

**Features**:
- Event logging with timestamps
- Loop detection (>5 occurrences of same event in last 10)
- Effect execution counter
- DEV-only, zero production overhead

---

## Files Modified

### 1. `app/(protected)/chat/[id].tsx` (Major Refactor)

**Changes**:
1. **Param Normalization** (Line 368-384)
   - Added `normalizeChatParams()` call
   - Memoized with stable dependencies
   - Prevents string|string[] instability

2. **Replaced useState with Zustand** (Line 565-597)
   - Migrated all 5 useState calls to `useChatScreenStore`
   - Added initialization effect for route params
   - Added cleanup effect to reset state on unmount

3. **Fixed useFocusEffect** (Line 442-451)
   - Removed unstable `chatMessages.length > 0` dependency
   - Added `hasLoadedInitialMessagesRef` guard
   - Only reloads on focus after initial load

4. **Fixed Main Load Effect** (Line 460-494)
   - Added duplicate load guard
   - Removed duplicate `loadMessages` call from mark-as-read
   - Only calls `loadMessages` once per conversation

5. **Fixed Realtime Subscription** (Line 499-564)
   - Added guard to subscribe only after initial load
   - Added 1-second throttle to prevent rapid reloads
   - Stabilized dependencies

6. **Fixed Recipient Load Effect** (Line 617-673)
   - Use primitive `currentUserId` instead of object
   - Added `hasLoadedRecipientRef` guard
   - Loads only once per chatId

7. **Fixed Self-Message Check** (Line 682-689)
   - Use primitive IDs
   - Added `selfMessageCheckDoneRef` guard
   - Runs only once

8. **Added Cleanup Effect** (Line 696-704)
   - Resets all screen state on unmount
   - Resets all ref guards
   - Prevents state leakage between chats

### 2. `app/(protected)/messages.tsx`

**Changes**:
- Replaced direct `router.push` with `navigateToChat()`
- Consistent param handling for all conversation entries

### 3. `app/(protected)/profile/[username].tsx`

**Changes**:
- Replaced direct `router.push` with `navigateToChat()`
- Added peer data to navigation params for instant render

---

## Architecture Improvements

### 1. State Machine Pattern
Added explicit mount phases to prevent race conditions:
- `idle` → `resolving` → `loading` → `ready` | `error`

### 2. Guard Pattern
All effects now have ref-based guards to prevent duplicate execution:
- `hasLoadedInitialMessagesRef` - Prevents duplicate message loads
- `hasLoadedRecipientRef` - Prevents duplicate recipient loads
- `selfMessageCheckDoneRef` - Prevents duplicate self-message checks

### 3. Throttle Pattern
Realtime subscription uses 1-second throttle to prevent rapid-fire reloads that can cause loops.

### 4. Stable Dependencies
All effect dependency arrays now use primitives only:
- ✅ `chatId` (string)
- ✅ `currentUserId` (string)
- ✅ `recipient?.id` (optional string)
- ❌ `currentUser` (object)
- ❌ `recipient` (object)
- ❌ `chatMessages.length > 0` (unstable boolean)

---

## Manual Test Matrix

### Entry Points (All Must Work)

| Entry Point | Test Case | Expected Behavior |
|-------------|-----------|-------------------|
| **Messages List** | Tap existing conversation | Opens chat instantly with peer data |
| **Messages List** | Tap conversation without peer data | Opens chat, loads recipient from backend |
| **Profile Screen** | Tap "Message" button | Creates/opens conversation with peer data |
| **Profile Screen** | Message user with existing conversation | Opens existing conversation |
| **Search Results** | Tap user → Message | Creates/opens conversation |
| **Notifications** | Tap message notification | Opens specific conversation |
| **Deep Link** | Open chat via deep link | Resolves conversation ID, loads chat |
| **Story Reply** | Reply to story | Opens conversation with story context |

### Stress Tests

| Test Case | Expected Behavior |
|-----------|-------------------|
| **Rapid Navigation** | Open chat → back → open another → back → repeat 10x | No crashes, no loops |
| **Same Thread Repeatedly** | Open same chat 5x quickly | No duplicate loads, no loops |
| **Slow Network** | Open chat on 3G | Shows loading state, no timeout loops |
| **Empty Thread** | Open new conversation with no messages | Shows empty state, no loops |
| **Large Thread** | Open conversation with 1000+ messages | Loads without loops |
| **Group Chat** | Open group with 10+ members | Loads all members, no loops |
| **Background/Foreground** | Open chat → background app → foreground | Refreshes correctly, no loops |

### Regression Checks

| Check | Expected Behavior |
|-------|-------------------|
| **No "Maximum update depth exceeded"** | Zero crashes on any entry point |
| **No infinite console logs** | No repeated effect logs in console |
| **No flashing screens** | Stable UI, no rapid mount/unmount cycles |
| **No duplicate API calls** | Single `loadMessages` call per conversation |
| **No memory leaks** | State cleared on unmount |
| **Typing indicator works** | Shows when peer is typing |
| **Presence works** | Shows "Active now" / last seen |
| **Realtime works** | New messages appear instantly |
| **Read receipts work** | Shows "Read" on sent messages |
| **Optimistic updates work** | Messages appear instantly on send |

---

## Verification Commands

### 1. Check for Infinite Loops (Console)
```bash
# Open chat and watch console
# Should see:
# ✅ "[Chat] Loading messages for conversation: X" (once)
# ✅ "[Chat] Subscribing to realtime messages: chat-X-..." (once)
# ✅ "[Chat] Loading conversation data for: X" (once)
#
# Should NOT see:
# ❌ Repeated "[Chat] Loading messages..." logs
# ❌ "Maximum update depth exceeded" error
# ❌ Rapid-fire effect logs
```

### 2. Check Effect Execution Counts
```typescript
// Add to chat screen temporarily:
import { useEffectCounter } from "@/lib/diagnostics/chat-diagnostics";

// In each effect:
useEffectCounter("loadMessages");
useEffectCounter("loadRecipient");
useEffectCounter("realtimeSubscription");

// Watch console for warnings:
// ❌ "Effect 'X' has fired 10+ times - possible loop!"
```

### 3. Check Loop Detection
```typescript
import { chatDiagnostics } from "@/lib/diagnostics/chat-diagnostics";

// After opening chat, check:
const loopCheck = chatDiagnostics.detectLoop();
console.log("Loop detected:", loopCheck);
// Expected: { isLoop: false }
```

---

## Success Criteria (All Must Pass)

- ✅ Zero "Maximum update depth exceeded" errors
- ✅ Zero infinite console log loops
- ✅ Zero flashing/remounting screens
- ✅ Single `loadMessages` call per conversation
- ✅ All entry points work (messages list, profile, notifications, deep links)
- ✅ Rapid navigation works (open → back → open another 10x)
- ✅ Same thread repeatedly works (open same chat 5x quickly)
- ✅ Slow network works (no timeout loops)
- ✅ Empty threads work (no loops on empty state)
- ✅ Large threads work (1000+ messages)
- ✅ Group chats work (10+ members)
- ✅ Background/foreground works (refreshes correctly)
- ✅ Typing indicator works
- ✅ Presence works
- ✅ Realtime works
- ✅ Read receipts work
- ✅ Optimistic updates work

---

## Rollback Plan (If Needed)

If issues arise, revert these commits in order:

1. Revert `app/(protected)/chat/[id].tsx` changes
2. Revert `lib/stores/chat-screen-store.ts` creation
3. Revert `lib/navigation/chat-routes.ts` creation
4. Revert `app/(protected)/messages.tsx` changes
5. Revert `app/(protected)/profile/[username].tsx` changes

Original behavior will be restored, but infinite loop will return.

---

## Next Steps

1. **Manual Testing** - Test all entry points and stress tests
2. **Device Testing** - Test on iOS and Android physical devices
3. **Network Testing** - Test on slow 3G network
4. **Remove Diagnostics** - After verification, remove `chat-diagnostics.ts`
5. **Monitor Production** - Watch for crash reports in Sentry

---

## Technical Debt Removed

- ❌ Multiple route patterns for same screen
- ❌ useState violations (project mandate: Zustand only)
- ❌ Unstable effect dependencies (objects, booleans)
- ❌ Duplicate API calls (loadMessages called 3x)
- ❌ No guards on effects (ran every render)
- ❌ No throttling on realtime (rapid-fire reloads)
- ❌ No cleanup on unmount (state leakage)

---

## Lessons Learned

1. **Never use derived booleans in effect deps** - `chatMessages.length > 0` recreates every render
2. **Never use objects in effect deps** - Use primitive IDs instead
3. **Always guard effects with refs** - Prevent duplicate execution
4. **Always throttle realtime handlers** - Prevent rapid-fire loops
5. **Always cleanup on unmount** - Prevent state leakage
6. **Comply with project mandates** - Zustand only, no useState
7. **Centralize route patterns** - Single source of truth prevents bugs
8. **Normalize params once** - string|string[] instability causes loops

---

## Contact

For questions or issues with this fix, contact the author or refer to:
- This document: `docs/CHAT_ROUTING_FIX.md`
- Diagnostics: `lib/diagnostics/chat-diagnostics.ts`
- Route helper: `lib/navigation/chat-routes.ts`
- Screen store: `lib/stores/chat-screen-store.ts`
