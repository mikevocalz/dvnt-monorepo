# API Endpoint Inventory

> **Architecture**: Supabase Edge Functions  
> **Base URL**: `https://npfjanxturvmjyevoyfo.supabase.co/functions/v1`  
> **Auth**: Better Auth token in `Authorization: Bearer <token>` header

## Endpoint Table

| Method             | Path                               | Auth | DTO                                       | Used By             |
| ------------------ | ---------------------------------- | ---- | ----------------------------------------- | ------------------- |
| **AUTH**           |
| POST               | `/api/users/login`                 | No   | `{ user, token }`                         | Login screen        |
| POST               | `/api/register`                    | No   | `{ user, token }`                         | Register screen     |
| GET                | `/api/users/me`                    | Yes  | `{ user }`                                | Auth store, Profile |
| POST               | `/api/users/logout`                | Yes  | `{ success }`                             | Settings            |
| **USERS/PROFILES** |
| GET                | `/api/users/:id`                   | No   | `User`                                    | Profile screen      |
| GET                | `/api/users/:id/profile`           | Yes  | `ProfileDTO`                              | Profile screen      |
| GET                | `/api/users/:id/posts`             | No   | `PaginatedResponse<Post>`                 | Profile posts tab   |
| POST               | `/api/users/me/avatar`             | Yes  | `{ avatarUrl }`                           | Edit profile        |
| **FOLLOWS**        |
| POST               | `/api/users/follow`                | Yes  | `{ following, followersCount }`           | Profile, Feed       |
| DELETE             | `/api/users/follow`                | Yes  | `{ following, followersCount }`           | Profile, Feed       |
| GET                | `/api/users/:id/follow-state`      | Yes  | `{ isFollowing, isFollowedBy }`           | Profile             |
| **POSTS**          |
| GET                | `/api/posts`                       | No   | `PaginatedResponse<Post>`                 | Explore             |
| GET                | `/api/posts/feed`                  | Yes  | `PaginatedResponse<Post>`                 | Home feed           |
| POST               | `/api/posts`                       | Yes  | `Post`                                    | Create post         |
| GET                | `/api/posts/:id`                   | No   | `Post`                                    | Post detail         |
| PATCH              | `/api/posts/:id`                   | Yes  | `Post`                                    | Edit post           |
| DELETE             | `/api/posts/:id`                   | Yes  | `{ success }`                             | Delete post         |
| **LIKES**          |
| POST               | `/api/posts/:id/like`              | Yes  | `{ liked, likesCount }`                   | Feed, Post detail   |
| DELETE             | `/api/posts/:id/like`              | Yes  | `{ liked, likesCount }`                   | Feed, Post detail   |
| GET                | `/api/posts/:id/like-state`        | Yes  | `{ liked, likesCount }`                   | Feed, Post detail   |
| POST               | `/api/comments/:id/like`           | Yes  | `{ liked, likesCount }`                   | Comments            |
| DELETE             | `/api/comments/:id/like`           | Yes  | `{ liked, likesCount }`                   | Comments            |
| **BOOKMARKS**      |
| POST               | `/api/posts/:id/bookmark`          | Yes  | `{ bookmarked }`                          | Feed, Post detail   |
| DELETE             | `/api/posts/:id/bookmark`          | Yes  | `{ bookmarked }`                          | Feed, Post detail   |
| GET                | `/api/posts/:id/bookmark-state`    | Yes  | `{ bookmarked }`                          | Feed, Post detail   |
| GET                | `/api/users/me/bookmarks`          | Yes  | `PaginatedResponse<Post>`                 | Saved tab           |
| **COMMENTS**       |
| GET                | `/api/posts/:id/comments`          | No   | `PaginatedResponse<Comment>`              | Post detail         |
| POST               | `/api/posts/:id/comments`          | Yes  | `Comment`                                 | Post detail         |
| **STORIES**        |
| GET                | `/api/stories`                     | No   | `PaginatedResponse<Story>`                | Stories bar         |
| POST               | `/api/stories`                     | Yes  | `Story`                                   | Create story        |
| GET                | `/api/stories/:id`                 | No   | `Story`                                   | Story viewer        |
| POST               | `/api/stories/:id/view`            | Yes  | `{ viewed }`                              | Story viewer        |
| POST               | `/api/stories/:id/reply`           | Yes  | `Message`                                 | Story viewer        |
| **MESSAGING**      |
| POST               | `/api/conversations/direct`        | Yes  | `Conversation`                            | New message         |
| POST               | `/api/conversations/group`         | Yes  | `Conversation`                            | New group           |
| GET                | `/api/conversations`               | Yes  | `{ docs, box }`                           | Messages list       |
| GET                | `/api/conversations/:id/messages`  | Yes  | `PaginatedResponse<Message>`              | Chat screen         |
| POST               | `/api/conversations/:id/messages`  | Yes  | `Message`                                 | Chat screen         |
| POST               | `/api/conversations/:id/read`      | Yes  | `{ read }`                                | Chat screen         |
| **NOTIFICATIONS**  |
| GET                | `/api/notifications`               | Yes  | `PaginatedResponse<Notification>`         | Activity tab        |
| POST               | `/api/notifications/:id/read`      | Yes  | `{ read }`                                | Activity tab        |
| POST               | `/api/notifications/read-all`      | Yes  | `{ success }`                             | Activity tab        |
| GET                | `/api/badges`                      | Yes  | `{ notificationsUnread, messagesUnread }` | Tab badges          |
| **DEVICES/PUSH**   |
| POST               | `/api/devices/register`            | Yes  | `{ registered, deviceId }`                | App startup         |
| **EVENTS**         |
| GET                | `/api/events`                      | No   | `PaginatedResponse<Event>`                | Events list         |
| POST               | `/api/events`                      | Yes  | `Event`                                   | Create event        |
| GET                | `/api/events/:id`                  | No   | `Event`                                   | Event detail        |
| POST               | `/api/events/:id/rsvp`             | Yes  | `{ rsvpStatus, participantsCount }`       | Event detail        |
| GET                | `/api/events/:id/participants`     | No   | `PaginatedResponse<User>`                 | Event detail        |
| GET                | `/api/events/:id/comments`         | No   | `PaginatedResponse<Comment>`              | Event detail        |
| POST               | `/api/events/:id/comments`         | Yes  | `Comment`                                 | Event detail        |
| GET                | `/api/events/:id/ticket`           | Yes  | `Ticket`                                  | My tickets          |
| **TICKETS**        |
| GET                | `/api/tickets/me`                  | Yes  | `{ tickets }`                             | Settings            |
| POST               | `/api/tickets/check-in`            | Yes  | `{ success }`                             | Event check-in      |
| **MEDIA**          |
| POST               | `/api/media/upload`                | Yes  | `{ url, id }`                             | Create post/story   |
| GET                | `/api/media/upload-config`         | Yes  | `{ config }`                              | Upload flow         |
| **BLOCKS**         |
| GET                | `/api/blocks/me`                   | Yes  | `PaginatedResponse<Block>`                | Settings            |
| POST               | `/api/blocks`                      | Yes  | `Block`                                   | Profile             |
| DELETE             | `/api/blocks/:id`                  | Yes  | `{ success }`                             | Settings            |
| GET                | `/api/blocks/check/:userId`        | Yes  | `{ blocked }`                             | Profile             |
| **SETTINGS**       |
| GET                | `/api/users/me/notification-prefs` | Yes  | `NotificationPrefs`                       | Settings            |
| PATCH              | `/api/users/me/notification-prefs` | Yes  | `NotificationPrefs`                       | Settings            |
| GET                | `/api/users/me/privacy`            | Yes  | `PrivacySettings`                         | Settings            |
| PATCH              | `/api/users/me/privacy`            | Yes  | `PrivacySettings`                         | Settings            |

## Smoke Test Results

### Public Endpoints (No Auth)

- ✅ GET /api/posts
- ✅ GET /api/users
- ✅ GET /api/events
- ✅ GET /api/stories
- ⚠️ GET /api/comments (requires postId filter)

### Authenticated Endpoints

Run with: `JWT_TOKEN=your_token ./tests/smoke-tests.sh`

## Files

- **Endpoint definitions**: `lib/api/endpoints.ts`
- **API client**: `lib/api-client.ts`
- **Smoke tests**: `tests/smoke-tests.sh`
