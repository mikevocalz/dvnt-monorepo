# 🚨 Deployment Safety Protocol

**CRITICAL**: Follow this checklist before EVERY deployment to prevent production regressions.

## ⚠️ Known High-Risk Areas

### 1. User Object Access
**DANGER**: Accessing properties that don't exist on `AppUser` type

```typescript
// ❌ FORBIDDEN - These properties don't exist on AppUser
user.fullName
user.posts_count
user.followers_count

// ✅ CORRECT - Use these instead
user.name
user.postsCount
user.followersCount
```

**Where to check**:
- `app/(protected)/profile/[username].tsx`
- `app/(protected)/edit-profile.tsx`
- Any component accessing user data

### 2. Conversation/Chat Identifiers
**DANGER**: Passing integer IDs instead of username/authId

```typescript
// ❌ FORBIDDEN - Don't pass integer user.id
messagesApiClient.getOrCreateConversation(String(user.id))

// ✅ CORRECT - Use username or authId
messagesApiClient.getOrCreateConversation(user.username)
messagesApiClient.getOrCreateConversation(user.authId)
```

**Where to check**:
- Profile screen message buttons
- Chat navigation logic
- Any conversation creation

### 3. Optimistic Updates
**DANGER**: Breaking user object structure in optimistic updates

```typescript
// ❌ FORBIDDEN - Don't add non-existent fields
const optimisticUser = {
  ...user,
  fullName: "...",  // doesn't exist!
  someNewField: "..." // will break downstream
};

// ✅ CORRECT - Spread user, only override known fields
const optimisticUser = {
  ...user,
  name: newName,
  avatar: newAvatar,
};
```

---

## 📋 Pre-Deployment Checklist

### Before `git push`

- [ ] **Run TypeScript check**: `npx tsc --noEmit`
- [ ] **Check for forbidden patterns**: `npm run lint:critical`
- [ ] **Test profile save flow**: Edit profile → Save → Navigate away → Back
- [ ] **Test chat flow**: Visit profile → Message button → Chat loads
- [ ] **Check console**: No React errors or warnings

### Before `eas update`

- [ ] **Code is on `main`**: Committed and pushed
- [ ] **OTA update message is descriptive**: Explains what was changed
- [ ] **Test on device**: If possible, test the exact change on a device first
- [ ] **Verify bundle size**: Ensure no huge increases

### After Deployment

- [ ] **Monitor crash logs**: Check Sentry/error tracking for 15 minutes
- [ ] **Test on own device**: Force restart app and verify fix
- [ ] **Check user feedback**: Monitor support channels

---

## 🛡️ Type Safety Rules

### AppUser Type Definition
**Source**: `lib/auth-client.ts:240-255`

```typescript
export interface AppUser {
  id: string;
  authId?: string;
  email: string;
  username: string;
  name: string;
  avatar?: string;
  bio?: string;
  website?: string;
  location?: string;
  hashtags?: string[];
  isVerified: boolean;
  postsCount: number;
  followersCount: number;
  followingCount: number;
}
```

**ONLY these properties exist. Do NOT access any other properties.**

### Safe Property Access Pattern

```typescript
// ✅ ALWAYS use optional chaining for optional fields
const avatar = user?.avatar;
const bio = user?.bio;

// ✅ ALWAYS provide defaults for counts
const posts = user.postsCount ?? 0;
const followers = user.followersCount ?? 0;

// ✅ NEVER assume new fields exist
// Bad: const fullName = user.fullName || user.name;
// Good: const displayName = user.name || user.username;
```

---

## 🧪 Critical Test Scenarios

### Profile Flow
1. Navigate to own profile
2. Tap "Edit Profile"
3. Change name, bio, avatar
4. Tap "Save"
5. ✅ Should show success toast
6. ✅ Should return to profile
7. ✅ Changes should be visible
8. Navigate away and back
9. ✅ Changes should persist

### Chat Flow
1. Navigate to any user profile
2. Tap "Message" button
3. ✅ Chat screen should load (not "Couldn't load chat")
4. Type a message
5. Send message
6. ✅ Message should appear in chat

### Navigation Dependency Arrays
When using `useCallback` or `useEffect` with user data:

```typescript
// ✅ CORRECT - Only include properties that exist
useCallback(() => {
  // ...
}, [user.id, user.username, user.name, user.avatar]);

// ❌ WRONG - Includes non-existent property
useCallback(() => {
  // ...
}, [user.id, user.fullName]); // fullName doesn't exist!
```

---

## 🚫 Forbidden Patterns

### 1. Type Casting Without Validation
```typescript
// ❌ FORBIDDEN
const pronouns = (user as any).pronouns;

// ✅ CORRECT - Add to AppUser interface or use helper
interface ExtendedUser extends AppUser {
  pronouns?: string;
}
```

### 2. Direct Integer ID Usage in APIs
```typescript
// ❌ FORBIDDEN
await api.getOrCreateConversation(user.id);

// ✅ CORRECT
await api.getOrCreateConversation(user.username || user.authId);
```

### 3. Mutation of Cached Objects
```typescript
// ❌ FORBIDDEN
const cachedUser = queryClient.getQueryData(['user']);
cachedUser.name = "New Name"; // mutates cache!

// ✅ CORRECT
queryClient.setQueryData(['user'], (old) => ({
  ...old,
  name: "New Name"
}));
```

---

## 📊 Monitoring After Deploy

### Immediate (0-15 minutes)
- Watch for crash rate spike in error tracking
- Check app doesn't crash on profile/chat screens
- Verify OTA update is being delivered

### Short-term (15-60 minutes)
- Monitor user reports in support channels
- Check for console errors in logs
- Verify all critical flows work

### Long-term (1-24 hours)
- Review crash analytics
- Check for regression issues
- Monitor OTA adoption rate

---

## 🔥 Emergency Rollback

If critical issues are discovered:

```bash
# 1. Identify last working update group ID
# Find in: https://expo.dev/accounts/dvntproject-2/projects/dvnt/updates

# 2. Republish that update
eas update --branch production --message "ROLLBACK: Reverting to stable" --environment production

# 3. Investigate issue locally before redeploying
```

---

## ✅ Success Criteria

A deployment is safe when:
- [ ] No TypeScript errors
- [ ] All critical flows tested manually
- [ ] No new console errors/warnings
- [ ] Code reviewed for forbidden patterns
- [ ] Changes are minimal and focused
- [ ] OTA message is descriptive
- [ ] Crash logs show no spike

---

## 📝 Commit Message Standards

```bash
# Feature
feat: Add user preferences screen

# Bug fix
fix: Profile crash on save

# Emergency hotfix
HOTFIX: Fix chat loading - critical regression

# Performance
perf: Optimize feed rendering

# Refactor
refactor: Extract profile header component
```

**Emergency hotfixes should be prefixed with `HOTFIX:` for visibility**

---

## 🎯 Root Cause Prevention

### Today's Issues (Mar 24, 2026)
1. **Profile Crash**: Accessed `user.fullName` which doesn't exist on `AppUser`
2. **Chat Loading**: Passed integer `user.id` instead of `username` to conversation API

### Prevention
- Always reference AppUser interface when accessing user properties
- Use TypeScript strict mode (already enabled)
- Add type guards for critical operations
- Test critical flows before every deployment
- Code review focuses on type safety

---

**Last Updated**: March 24, 2026  
**Incidents This Week**: 3 critical (profile crash, chat loading)  
**Target**: 0 critical incidents per week
