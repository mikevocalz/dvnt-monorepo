export const notificationKeys = {
  all: ["notifications"] as const,
  list: (viewerId: string) => ["notifications", viewerId] as const,
  badges: (viewerId: string) => ["badges", viewerId] as const,
};
