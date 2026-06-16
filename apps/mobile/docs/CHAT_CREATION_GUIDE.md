# Chat/Conversation Creation Guide

**CRITICAL**: This guide prevents the "unable to chat with new users" bug from recurring.

## ✅ Correct Usage

### Option 1: Use authId (Preferred)
```typescript
// authId is a UUID from auth.users.id
const conversationId = await messagesApiClient.getOrCreateConversation(
  user.authId
);
```

### Option 2: Use numeric user.id
```typescript
// user.id is an integer
const conversationId = await messagesApiClient.getOrCreateConversation(
  String(user.id)
);
```

### Option 3: Defensive - Pick best available
```typescript
// Use authId if available, fallback to user.id
const identifier = user.authId || String(user.id);
const conversationId = await messagesApiClient.getOrCreateConversation(
  identifier
);
```

---

## ❌ WRONG Usage

### DON'T pass username
```typescript
// ❌ WRONG - This will throw an error
const conversationId = await messagesApiClient.getOrCreateConversation(
  user.username  // NEVER DO THIS!
);
```

### Why username doesn't work
- `getOrCreateConversation` expects either:
  - **UUID** (authId from `auth.users.id`) 
  - **Numeric string** (integer user.id)
- Usernames can contain letters/underscores and won't resolve correctly
- The function validates input and will reject usernames with a clear error

---

## Implementation Details

### Function Signature
```typescript
async getOrCreateConversation(otherUserId: string): Promise<string>
```

### Input Validation
The function validates that input is either:
- Numeric: `/^\d+$/` (e.g., "123", "456")
- UUID: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`

If validation fails, it throws:
```
Error: Invalid user identifier. Use authId (UUID) or numeric user.id, not username.
```

### Resolution Flow
1. **Input validation** - Reject if not UUID or numeric
2. **Try `resolveUserIdInt()`** - Attempts to convert to integer
3. **If fails with "NEEDS_PROVISION"** - Uses authId path
4. **Call edge function** - `create-conversation` with proper payload
5. **Return** - Conversation ID

---

## Locations Using This Function

### ✅ Correctly Implemented
- `app/(protected)/profile/[username].tsx` - Message button (uses authId/id)
- `lib/hooks/use-conversation-resolution.ts` - Conversation resolution hook

### 🔍 Always Check
When adding new "message" or "chat" buttons:
1. **Never** pass `user.username`
2. **Always** use `user.authId` or `user.id`
3. **Add** defensive validation before calling

---

## Testing Checklist

Before deploying changes that use conversation creation:

- [ ] Navigate to a user profile
- [ ] Tap "Message" button
- [ ] Chat screen should load successfully
- [ ] Send a test message
- [ ] Message should appear in conversation
- [ ] Check console for any validation errors

---

## Error Messages

### "Invalid user identifier"
**Cause**: Passed username instead of authId/userId  
**Fix**: Use `user.authId` or `String(user.id)`

### "Failed to create conversation"
**Cause**: Edge function error (check server logs)  
**Fix**: Verify Supabase function deployment and permissions

### "NEEDS_PROVISION"
**Cause**: User exists in auth but not in app users table  
**Fix**: Normal - function handles this automatically

---

## Prevention Measures

1. **Input validation** in `getOrCreateConversation` - Rejects non-UUID/non-numeric
2. **JSDoc comments** - Clear documentation on expected input
3. **Defensive checks** - Profile screen validates before calling
4. **This guide** - Reference for all future implementations

---

**Last Updated**: March 24, 2026  
**Related Hotfixes**: #3 (chat loading), #6 (chat with new users)
