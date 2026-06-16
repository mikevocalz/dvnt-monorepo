# Video Chat System - Setup & Hardening Guide

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Expo RN)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ RoomsList   │  │ VideoRoom   │  │ useVideoRoom Hook       │ │
│  │ Screen      │  │ Screen      │  │ - join/leave            │ │
│  │             │  │             │  │ - camera/mic controls   │ │
│  │             │  │             │  │ - kick/ban actions      │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│         │                │                      │               │
│         ▼                ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Supabase Client + Realtime                     ││
│  │  - Auth (JWT)                                               ││
│  │  - Edge Function calls                                      ││
│  │  - Realtime subscriptions (events, members)                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SUPABASE EDGE FUNCTIONS                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐│
│  │video_create  │ │video_join    │ │video_kick/ban/end        ││
│  │_room         │ │_room         │ │                          ││
│  │              │ │              │ │- Revoke tokens           ││
│  │              │ │- Mint token  │ │- Update membership       ││
│  │              │ │- Create peer │ │- Broadcast eject event   ││
│  └──────────────┘ └──────────────┘ └──────────────────────────┘│
│         │                │                      │               │
│         ▼                ▼                      ▼               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                 SUPABASE POSTGRES                           ││
│  │  - video_rooms, video_room_members                          ││
│  │  - video_room_bans, video_room_kicks                        ││
│  │  - video_room_tokens (for revocation)                       ││
│  │  - video_room_events (audit + realtime)                     ││
│  │  - RLS policies enforce access control                      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FISHJAM SERVER                          │
│  - WebRTC SFU                                                   │
│  - Room management                                              │
│  - Peer connections                                             │
│  - Media routing                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Security Model

### Token Flow
1. User authenticates with Supabase Auth
2. Client calls `video_join_room` Edge Function with JWT
3. Edge Function validates:
   - User is authenticated
   - User is not banned from room
   - Room is open and not full
   - Rate limits not exceeded
4. Edge Function mints Fishjam token with metadata (userId, role, jti)
5. Token stored in `video_room_tokens` for revocation tracking
6. Client connects to Fishjam with token

### Kick/Ban Invalidation
1. Host/mod calls `video_kick_user` or `video_ban_user`
2. Edge Function:
   - Updates membership status to kicked/banned
   - Revokes all active tokens (sets `revoked_at`)
   - Removes peer from Fishjam room
   - Inserts `eject` event into `video_room_events`
3. Client receives realtime event via Supabase subscription
4. Client immediately disconnects and shows modal

### RLS Policy Summary
| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| video_rooms | Member OR public | Creator | Host only | Creator |
| video_room_members | Room members | Self (validated) | Self (leave) or mod (kick) | None |
| video_room_bans | Self or mod | Mod only | Host only | Host only |
| video_room_kicks | Self or mod | Mod only | None | None |
| video_room_tokens | Self only | Service role | Service role | Service role |
| video_room_events | Room members | Service role | None | None |

---

## Setup Instructions

### 1. Environment Variables

Add to `.env`:
```bash
# Fishjam Server
FISHJAM_URL=https://your-fishjam-server.com
FISHJAM_API_KEY=your-fishjam-api-key
```

### 2. Supabase Secrets

```bash
# Set Edge Function secrets
supabase secrets set FISHJAM_URL="https://your-fishjam-server.com"
supabase secrets set FISHJAM_API_KEY="your-fishjam-api-key"
```

### 3. Run Migrations

```bash
# Apply video chat schema
supabase db push

# Or run specific migrations
psql $DATABASE_URL -f supabase/migrations/20260203_video_chat.sql
psql $DATABASE_URL -f supabase/migrations/20260203_video_chat_rls.sql
```

### 4. Deploy Edge Functions

```bash
supabase functions deploy video_create_room --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
supabase functions deploy video_join_room --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
supabase functions deploy video_refresh_token --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
supabase functions deploy video_kick_user --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
supabase functions deploy video_ban_user --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
supabase functions deploy video_end_room --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
```

### 5. Configure Edge Function JWT Verification

In `supabase/config.toml`:
```toml
[functions.video_create_room]
verify_jwt = false

[functions.video_join_room]
verify_jwt = false

[functions.video_refresh_token]
verify_jwt = false

[functions.video_kick_user]
verify_jwt = false

[functions.video_ban_user]
verify_jwt = false

[functions.video_end_room]
verify_jwt = false
```

(JWT verification is handled inside the functions for more control)

### 6. Rebuild Dev Client

Video chat requires native modules:
```bash
npx expo prebuild
eas build --profile development --platform android
eas build --profile development --platform ios
```

---

## Hardening Checklist

### Reconnection Strategy
- [x] Token refresh scheduled 5 minutes before expiry
- [x] Automatic reconnection on network recovery
- [x] Graceful handling of token revocation during reconnect
- [ ] Exponential backoff for failed reconnections (TODO)
- [ ] Offline queue for actions during disconnection (TODO)

### Background/Foreground Handling
- [x] AppState listener for background detection
- [ ] Pause video when backgrounded (battery saving)
- [ ] Resume connection when foregrounded
- [ ] Handle iOS CallKit integration for incoming calls

### Network Quality
- [x] Connection status banner (connecting, reconnecting, error)
- [x] Network quality indicator component
- [ ] Adaptive bitrate based on network conditions
- [ ] Audio-only fallback for poor connections

### Permissions Handling
- [ ] Request camera/mic permissions before joining
- [ ] Graceful UI when permissions denied
- [ ] Settings deep link for permission management
- [ ] Handle permission revocation mid-call

### Abuse Prevention
- [x] Rate limiting on join attempts (10/min per room)
- [x] Rate limiting on room creation (5/5min)
- [x] Rate limiting on token refresh (30/min)
- [x] Ban system with optional expiry
- [ ] Report user functionality
- [ ] Content moderation hooks

### Logging & Observability
- [x] Audit events in video_room_events table
- [x] Console logging for debugging
- [ ] Structured logging to external service
- [ ] Error tracking (Sentry integration)
- [ ] Analytics for call quality metrics

---

## Testing Steps

### 1. Basic Flow Test
```bash
# Create a test user
curl -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123456"}'

# Get JWT
JWT=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123456"}' | jq -r '.access_token')

# Create room
curl -X POST "$SUPABASE_URL/functions/v1/video_create_room" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Room","isPublic":true}'

# Join room (returns Fishjam token)
curl -X POST "$SUPABASE_URL/functions/v1/video_join_room" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>"}'
```

### 2. Kick/Ban Test
```bash
# As host, kick a user
curl -X POST "$SUPABASE_URL/functions/v1/video_kick_user" \
  -H "Authorization: Bearer $HOST_JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>","targetUserId":"<user-id>","reason":"Testing"}'

# Verify kicked user cannot rejoin immediately
curl -X POST "$SUPABASE_URL/functions/v1/video_join_room" \
  -H "Authorization: Bearer $KICKED_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>"}'
# Should succeed (kick is temporary)

# Ban user
curl -X POST "$SUPABASE_URL/functions/v1/video_ban_user" \
  -H "Authorization: Bearer $HOST_JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>","targetUserId":"<user-id>","reason":"Testing","durationMinutes":60}'

# Verify banned user cannot join
curl -X POST "$SUPABASE_URL/functions/v1/video_join_room" \
  -H "Authorization: Bearer $BANNED_USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>"}'
# Should return 403 Forbidden
```

### 3. Token Revocation Test
```bash
# Join room and get token
RESPONSE=$(curl -s -X POST "$SUPABASE_URL/functions/v1/video_join_room" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>"}')
TOKEN=$(echo $RESPONSE | jq -r '.data.token')

# Kick user (revokes token)
curl -X POST "$SUPABASE_URL/functions/v1/video_kick_user" \
  -H "Authorization: Bearer $HOST_JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>","targetUserId":"<user-id>"}'

# Verify token refresh fails
curl -X POST "$SUPABASE_URL/functions/v1/video_refresh_token" \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<room-id>"}'
# Should return 403 (session terminated)
```

### 4. Rate Limiting Test
```bash
# Attempt to join same room 15 times rapidly
for i in {1..15}; do
  curl -s -X POST "$SUPABASE_URL/functions/v1/video_join_room" \
    -H "Authorization: Bearer $JWT" \
    -H "Content-Type: application/json" \
    -d '{"roomId":"<room-id>"}'
done
# After 10 attempts, should return 429 Too Many Requests
```

### 5. Realtime Event Test
```javascript
// In app, subscribe to events
const channel = supabase
  .channel('video_room_events:room-id')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'video_room_events',
    filter: 'room_id=eq.<room-id>'
  }, (payload) => {
    console.log('Event:', payload.new);
  })
  .subscribe();

// Trigger kick from another client
// Should see eject event in console
```

---

## File Structure

```
/supabase
  /migrations
    20260203_video_chat.sql        # Tables, indexes, functions
    20260203_video_chat_rls.sql    # RLS policies
  /functions
    /video_create_room/index.ts
    /video_join_room/index.ts
    /video_refresh_token/index.ts
    /video_kick_user/index.ts
    /video_ban_user/index.ts
    /video_end_room/index.ts

/src/video
  /hooks
    useVideoRoom.ts                 # Main video room hook
  /ui
    VideoTile.tsx                   # Participant video tile
    ControlsBar.tsx                 # Camera/mic/end controls
    ParticipantsSheet.tsx           # Participants list
    ConnectionBanner.tsx            # Connection status
    EjectModal.tsx                  # Kick/ban modals
    styles.ts                       # NativeWind design tokens
    index.ts                        # Barrel export
  api.ts                            # Edge Function client
  types.ts                          # TypeScript types
  index.ts                          # Module export

/app/(video)
  _layout.tsx                       # FishjamProvider wrapper
  rooms.tsx                         # Room list screen
  /room
    [id].tsx                        # Video room screen
```

---

## Troubleshooting

### "Invalid JWT" from Edge Functions
- Ensure JWT is passed in Authorization header
- Check token hasn't expired
- Verify `verify_jwt = false` in config.toml

### "Permission denied for schema public"
- Run: `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`

### Fishjam connection fails
- Verify FISHJAM_URL and FISHJAM_API_KEY secrets are set
- Check Fishjam server is running and accessible
- Ensure room was created in Fishjam before joining

### Realtime events not received
- Verify `video_room_events` is in supabase_realtime publication
- Check subscription filter matches room_id
- Ensure user has SELECT permission on events table

### Camera/mic not working
- Rebuild dev client after adding permissions
- Check app has camera/microphone permissions
- Verify Fishjam peer was created successfully
