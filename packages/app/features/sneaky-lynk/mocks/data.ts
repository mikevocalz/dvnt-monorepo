/**
 * Mock data for Sneaky Lynk
 * TODO: Replace with real Supabase queries
 */

import type { SneakyUser, MockSpace } from "../types";

export const mockUsers: SneakyUser[] = [
  {
    id: "1",
    username: "alexchen",
    displayName: "Alex Chen",
    avatar: "https://i.pravatar.cc/150?u=alexchen",
    isVerified: true,
  },
  {
    id: "2",
    username: "sarahj",
    displayName: "Sarah Johnson",
    avatar: "https://i.pravatar.cc/150?u=sarahj",
    isVerified: true,
  },
  {
    id: "3",
    username: "mikewilson",
    displayName: "Mike Wilson",
    avatar: "https://i.pravatar.cc/150?u=mikewilson",
    isVerified: false,
  },
  {
    id: "4",
    username: "emilydavis",
    displayName: "Emily Davis",
    avatar: "https://i.pravatar.cc/150?u=emilydavis",
    isVerified: true,
  },
  {
    id: "5",
    username: "jasonlee",
    displayName: "Jason Lee",
    avatar: "https://i.pravatar.cc/150?u=jasonlee",
    isVerified: false,
  },
  {
    id: "6",
    username: "lisapark",
    displayName: "Lisa Park",
    avatar: "https://i.pravatar.cc/150?u=lisapark",
    isVerified: true,
  },
];

// Current user mock (for testing as host)
export const currentUserMock: SneakyUser = {
  id: "current-user",
  username: "you",
  displayName: "You (Host)",
  avatar: "https://i.pravatar.cc/150?u=currentuser",
  isVerified: true,
};

export const mockSpaces: MockSpace[] = [
  {
    id: "my-room",
    title: "Your Test Room (Host Mode)",
    topic: "Technology",
    description:
      "Test being a host with video enabled. You have full controls!",
    isLive: true,
    hasVideo: true,
    listeners: 42,
    host: currentUserMock,
    speakers: [mockUsers[1], mockUsers[2]],
  },
  {
    id: "space-1",
    title: "Building the Future of AI",
    topic: "Technology",
    description:
      "Join us as we discuss the latest developments in artificial intelligence and machine learning.",
    isLive: true,
    hasVideo: true,
    listeners: 1247,
    host: mockUsers[0],
    speakers: [mockUsers[1], mockUsers[2]],
  },
  {
    id: "space-2",
    title: "Late Night Music Vibes",
    topic: "Music",
    description:
      "Chill beats and good conversations. Share your favorite tracks!",
    isLive: true,
    hasVideo: false,
    listeners: 892,
    host: mockUsers[3],
    speakers: [mockUsers[4]],
  },
  {
    id: "space-3",
    title: "Startup Funding 101",
    topic: "Business",
    description:
      "Learn how to pitch to investors and secure your first round of funding.",
    isLive: true,
    hasVideo: true,
    listeners: 456,
    host: mockUsers[5],
    speakers: [mockUsers[0], mockUsers[2]],
  },
  {
    id: "space-4",
    title: "Design Systems Deep Dive",
    topic: "Design",
    description:
      "Exploring component libraries, tokens, and scalable design patterns.",
    isLive: true,
    hasVideo: false,
    listeners: 234,
    host: mockUsers[1],
    speakers: [mockUsers[4], mockUsers[5]],
  },
];

export const TOPICS = [
  "All",
  "Technology",
  "Music",
  "Business",
  "Design",
  "Community",
] as const;
export type Topic = (typeof TOPICS)[number];
