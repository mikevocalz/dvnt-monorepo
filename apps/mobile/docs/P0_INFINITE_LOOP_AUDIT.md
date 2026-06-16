# P0 Production Incident: Maximum Update Depth Exceeded - App-Wide Audit

## Incident Status: IN PROGRESS
**Severity**: P0 - Production Stop-the-Line  
**Started**: Mar 22, 2026 7:43pm UTC-04:00  
**Scope**: App-wide audit and fix for all infinite render/update loops

---

## Executive Summary

Comprehensive app-wide audit to identify and eliminate ALL sources of "Maximum update depth exceeded" errors across DVNT. Initial fix completed for chat screen, now expanding to full app audit.

---

## Audit Methodology

### Phase 1: Screen Inventory (IN PROGRESS)
Identified **34 routed screens** using `useLocalSearchParams`:
- 9 dynamic [id] routes
- 25 other parameterized routes
- All require param normalization audit

### Phase 2: Pattern Detection (IN PROGRESS)
Searching for:
- ✅ Unstable effect dependencies (objects, arrays, booleans)
- ✅ navigation.setOptions in render loops
- ✅ useState violations (project mandate: Zustand only)
- ✅ Query enabled conditions with unstable deps
- ✅ Store synchronization loops
- ⏳ Router param loops
- ⏳ Bootstrap/create-on-mount loops
- ⏳ Subscription reattachment loops

### Phase 3: Risk Ranking (PENDING)
Rank all findings by:
- Production impact (crash frequency)
- Affected user flows
- Fix complexity
- Regression risk

---

## Findings Summary

### CRITICAL: Chat Screen (FIXED)
**Status**: ✅ Fixed in previous session  
**Root Causes**: 5 infinite loop sources  
**Files**: `app/(protected)/chat/[id].tsx`  
**Details**: See `docs/CHAT_ROUTING_FIX.md`

### HIGH RISK: Post Detail Screen
**File**: `app/(protected)/post/[id].tsx`  
**Status**: 🔍 Under audit  
**Patterns Detected**:
- Uses `useState` (9 calls) - violates Zustand mandate
- Raw `useLocalSearchParams()` without normalization
- Multiple video player effects with complex lifecycle
- `useFocusEffect` for video play/pause
- Tag overlay state management

**Potential Loop Sources**:
```typescript
// Line 424: Raw params without normalization
const rawParams = useLocalSearchParams();

// Line 187-201: useFocusEffect with player dependency
useFocusEffect(
  useCallback(() => {
    if (player && videoUrl && isSafeToOperate()) {
      safePlay(player, isMountedRef, "PostDetail");
      setIsPlaying(true);
    }
    return () => {
      // Cleanup
    };
  }, [player, videoUrl, isSafeToOperate, isMountedRef]),
);

// Multiple useState calls throughout
```

### HIGH RISK: Event Detail Screen
**File**: `app/(protected)/events/[id]/index.tsx`  
**Status**: 🔍 Under audit  
**Patterns Detected**:
- Direct `useLocalSearchParams<{ id: string }>()`
- No param normalization
- Complex event data fetching
- Ticket purchase flows
- Map integration

### HIGH RISK: Story Viewer
**File**: `app/(protected)/story/[id].tsx`  
**Status**: 🔍 Under audit  
**Patterns Detected**:
- Direct `useLocalSearchParams<{ id: string; username?: string }>()`
- Video player lifecycle
- Gesture handlers
- Progress tracking
- Auto-advance logic

### MEDIUM RISK: Comments Screens
**Files**: 
- `app/(protected)/comments/[postId].tsx`
- `app/(protected)/comments/replies/[commentId].tsx`
**Status**: 🔍 Under audit  
**Patterns Detected**:
- Direct param access
- Real-time comment subscriptions
- Nested reply threading
- Optimistic updates

### MEDIUM RISK: Profile Screen
**File**: `app/(protected)/profile/[username].tsx`  
**Status**: ✅ Partially fixed (uses canonical chat route helper)  
**Remaining Risks**:
- Raw `useLocalSearchParams` for username
- Complex follow state
- Post grid with masonry layout
- Multiple query dependencies

---

## High-Risk Patterns Identified App-Wide

### Pattern 1: Raw useLocalSearchParams (34 screens)
**Risk**: string|string[] type instability causes render loops  
**Affected**: All routed screens  
**Fix Required**: Normalize params once with useMemo

### Pattern 2: navigation.setOptions Without Stable Deps (8 screens)
**Risk**: Header updates every render trigger loops  
**Affected**:
- `events/[id]/comments.tsx`
- `story/editor.tsx`
- `story/create.tsx`
- `events/create.tsx`
- `crop-preview.tsx`
- `chat/[id].tsx` (FIXED)
- `comments/replies/[commentId].tsx`

**Fix Required**: Stable dependencies, guard with refs

### Pattern 3: useState Violations (Multiple screens)
**Risk**: Violates project mandate, causes render loops  
**Affected**:
- `post/[id].tsx` (9 calls)
- `events/[id]/index.tsx`
- `story/[id].tsx`
- Others TBD

**Fix Required**: Migrate to Zustand stores

### Pattern 4: useFocusEffect with Unstable Deps (Multiple screens)
**Risk**: Focus/blur cycles trigger infinite loops  
**Affected**:
- `post/[id].tsx` (video player)
- `story/[id].tsx` (video player)
- `chat/[id].tsx` (FIXED)

**Fix Required**: Stable dependencies, guard with refs

---

## Shared Hardening Required

### 1. Canonical Route Param Normalizer
**Status**: ✅ Created for chat (`lib/navigation/chat-routes.ts`)  
**Required**: Expand to all routed screens

```typescript
// lib/navigation/route-params.ts
export function normalizeRouteParams<T extends Record<string, any>>(
  rawParams: T
): { [K in keyof T]: string | undefined } {
  const normalized: any = {};
  for (const key in rawParams) {
    const val = rawParams[key];
    normalized[key] = Array.isArray(val) ? val[0] : val;
  }
  return normalized;
}
```

### 2. Safe Header Update Hook
**Status**: ⏳ Not created  
**Required**: Prevent navigation.setOptions loops

```typescript
// lib/hooks/use-safe-header.ts
export function useSafeHeader(
  title: string,
  deps: any[] = []
) {
  const navigation = useNavigation();
  const lastTitleRef = useRef<string>("");
  
  useLayoutEffect(() => {
    if (lastTitleRef.current === title) return;
    lastTitleRef.current = title;
    navigation.setOptions({ headerTitle: title });
  }, [navigation, title, ...deps]);
}
```

### 3. Screen State Machine Pattern
**Status**: ⏳ Not created  
**Required**: Prevent bootstrap loops

```typescript
// lib/patterns/screen-state-machine.ts
type ScreenPhase = "idle" | "validating" | "loading" | "ready" | "error";

export function useScreenStateMachine(initialPhase: ScreenPhase = "idle") {
  const [phase, setPhase] = useState(initialPhase);
  const phaseRef = useRef(phase);
  
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  
  const transitionTo = useCallback((newPhase: ScreenPhase) => {
    if (phaseRef.current === newPhase) return;
    console.log(`[StateMachine] ${phaseRef.current} → ${newPhase}`);
    setPhase(newPhase);
  }, []);
  
  return { phase, transitionTo, phaseRef };
}
```

### 4. Loop Detection Diagnostics
**Status**: ✅ Created (`lib/diagnostics/chat-diagnostics.ts`)  
**Required**: Expand to app-wide monitoring

---

## Implementation Plan

### Phase 1: Immediate Fixes (P0)
1. ✅ Chat screen (COMPLETE)
2. 🔄 Post detail screen
3. 🔄 Event detail screen
4. 🔄 Story viewer screen

### Phase 2: High-Risk Screens (P1)
5. Comments screens
6. Profile screen (complete)
7. Edit screens
8. Search screen

### Phase 3: Hardening (P1)
9. Create shared route param normalizer
10. Create safe header update hook
11. Create screen state machine pattern
12. Expand loop detection diagnostics

### Phase 4: Verification (P0)
13. Manual testing all entry points
14. Device testing iOS + Android
15. Stress testing (rapid navigation)
16. Monitor production logs

---

## Next Actions

1. **Complete post detail screen audit** - Identify all loop sources
2. **Complete event detail screen audit** - Identify all loop sources
3. **Complete story viewer audit** - Identify all loop sources
4. **Create shared hardening utilities** - Prevent recurrence
5. **Implement fixes for all P0 screens** - Production-grade solutions
6. **Add app-wide loop detection** - Monitor for regressions
7. **Create comprehensive test matrix** - Verify all fixes
8. **Deploy with monitoring** - Watch for any remaining loops

---

## Success Criteria

- ✅ Zero "Maximum update depth exceeded" errors in production
- ✅ All routed screens open reliably
- ✅ Rapid navigation stable (10x back/forth)
- ✅ Deep links work
- ✅ All features preserved (UX, messaging, events, stories, notifications)
- ✅ No performance regressions
- ✅ Clean console logs (no repeated effects)

---

## Risk Assessment

**Current Risk**: HIGH - Multiple screens likely affected  
**Post-Fix Risk**: LOW - Comprehensive hardening prevents recurrence  
**Rollback Risk**: LOW - Fixes are isolated and testable  

---

## Timeline

- **Audit Complete**: 2-3 hours
- **Fixes Implemented**: 4-6 hours
- **Testing Complete**: 2-3 hours
- **Production Deploy**: After all tests pass
- **Monitoring Period**: 1 week

**Total Estimated Time**: 8-12 hours for complete resolution

---

## Contact & Escalation

- **Technical Lead**: Review all fixes before deploy
- **QA**: Full regression testing required
- **DevOps**: Monitor crash reports post-deploy
- **On-Call**: Immediate rollback if new crashes detected

---

**Last Updated**: Mar 22, 2026 7:43pm UTC-04:00  
**Status**: Audit in progress, chat screen fixed, expanding to full app
