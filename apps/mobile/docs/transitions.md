# Shared Element Transitions — Deviant

## Overview

Shared element transitions use Reanimated's `sharedTransitionTag` to animate media elements between list and detail screens. The `SharedImage` component (`components/shared-image.tsx`) wraps `expo-image` with `Animated.createAnimatedComponent` and accepts a `sharedTag` prop.

## How to Assign Tags

Tags must be **unique** and **stable** across the source and destination screens.

### Post Media

```tsx
// Feed card (components/feed/feed-post.tsx)
<SharedImage sharedTag={`post-media-${id}`} source={{ uri: media[0].url }} ... />

// Post detail (app/(protected)/post/[id].tsx)
<SharedImage sharedTag={`post-media-${postIdString}`} source={{ uri: post.media[0].url }} ... />
```

### Event Hero (Future)

Event cards currently use parallax `Animated.View` for the hero image, which conflicts with `sharedTransitionTag`. If parallax is removed in the future:

```tsx
// Event card
<SharedImage sharedTag={`event-hero-${event.id}`} source={{ uri: event.image }} ... />

// Event detail
<SharedImage sharedTag={`event-hero-${eventId}`} source={{ uri: event.image }} ... />
```

## Do's

- **Pre-size media containers** with fixed aspect ratios (e.g., 4:5 for posts) to prevent layout shifts during transition.
- **Use `cachePolicy="memory-disk"`** on `SharedImage` so the image is already loaded on both screens.
- **Memoize list cards** (`React.memo`) to prevent re-renders mid-transition that would unmount the source element.
- **Use `fade` animation** on the Stack.Screen for the detail route — this works best with shared transitions.
- **Keep tags unique per item** — always include the entity ID in the tag string.

## Don'ts

- **Don't use `sharedTransitionTag` inside `Animated.View`** that has its own animated styles (e.g., parallax). The two animation systems conflict.
- **Don't use shared tags on carousel/multi-image posts** — only the visible slide would transition, causing visual glitches.
- **Don't use shared tags on video posts** — `VideoView` doesn't support `sharedTransitionTag`.
- **Don't change the tag string format** without updating both source and destination screens.
- **Don't add shared tags to elements that may not render** (e.g., conditional renders) — this causes Reanimated warnings.

## Navigation Config

The post detail screen uses `animation: "fade"` in `app/(protected)/_layout.tsx`:

```tsx
<Stack.Screen
  name="post/[id]"
  options={{
    animation: "fade",
    animationDuration: 300,
    animationTypeForReplace: "push",
  }}
/>
```

This fade provides a smooth backdrop for the shared element animation.

## Supported Transitions

| Source | Destination | Tag Pattern | Status |
|--------|-------------|-------------|--------|
| Feed post (single image) | Post detail | `post-media-${postId}` | Active |
| Feed post (carousel) | Post detail | N/A | Not supported (carousel) |
| Feed post (video) | Post detail | N/A | Not supported (VideoView) |
| Event card | Event detail | `event-hero-${eventId}` | Blocked by parallax |
