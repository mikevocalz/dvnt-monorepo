export const motionTags = {
  postCard: (postId: string) => `post-card:${postId}`,
  postMedia: (postId: string) => `post-media:${postId}`,
  postAvatar: (postId: string) => `post-avatar:${postId}`,
  storyThumb: (storyId: string) => `story-thumb:${storyId}`,
  eventCard: (eventId: string | number) => `event-card:${eventId}`,
  eventHero: (eventId: string | number) => `event-hero:${eventId}`,
  ticketCard: (ticketId: string | number) => `ticket-card:${ticketId}`,
  ticketHero: (ticketId: string | number) => `ticket-hero:${ticketId}`,
} as const;

