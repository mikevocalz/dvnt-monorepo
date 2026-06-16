export type Comment = {
  id: string;
  username: string;
  avatar: string;
  text: string;
  timeAgo: string;
  createdAt?: string;
  likes: number;
  hasLiked?: boolean;
  postId?: string;
  parentId?: string | null;
  rootId?: string | null;
  depth?: number;
  replies?: Comment[];
};

export type MediaKind = "image" | "gif" | "video" | "livePhoto" | "animated_video";
export type PostKind = "media" | "text";
export type TextPostThemeKey =
  | "graphite"
  | "deviant"
  | "cobalt"
  | "ember"
  | "sage";

export type TextPostSlide = {
  id: string;
  order: number;
  content: string;
};

export type PostMediaItem = {
  type: MediaKind;
  url: string;
  thumbnail?: string;
  mimeType?: string;
  livePhotoVideoUrl?: string;
};

export type Post = {
  id: string;
  author: {
    id?: string;
    username: string;
    avatar: string;
    verified?: boolean;
    name?: string;
  };
  media: PostMediaItem[];
  kind?: PostKind;
  textTheme?: TextPostThemeKey;
  caption?: string;
  textSlides?: TextPostSlide[];
  textSlideCount?: number;
  likes: number;
  viewerHasLiked?: boolean; // CRITICAL: Viewer's like state from API
  comments: Comment[] | number;
  timeAgo: string;
  createdAt?: string;
  location?: string;
  isNSFW?: boolean;
  thumbnail?: string; // First media thumbnail for grid display
  type?: MediaKind; // Primary media type
  hasMultipleImages?: boolean; // Has carousel/multiple media
};

export type StoryItemType = "image" | "gif" | "video" | "livePhoto" | "text";

export type StoryAnimatedGifOverlay = {
  id: string;
  url: string;
  x: number;
  y: number;
  sizeRatio: number;
  scale: number;
  rotation: number;
};

export type StoryOverlay =
  | {
      id: string;
      type: "animated_gif";
      url: string;
      x: number;
      y: number;
      sizeRatio: number;
      scale: number;
      rotation: number;
      opacity?: number;
    }
  | {
      id: string;
      type: "emoji";
      emoji: string;
      x: number;
      y: number;
      sizeRatio: number;
      scale: number;
      rotation: number;
      opacity?: number;
    }
  | {
      id: string;
      type: "text";
      content: string;
      x: number;
      y: number;
      scale: number;
      rotation: number;
      opacity?: number;
      color: string;
      backgroundColor?: string;
      fontFamily?: string;
      fontSizeRatio: number;
      maxWidthRatio: number;
      textAlign?: "left" | "center" | "right";
    }
  | {
      id: string;
      type: "sticker";
      x: number;
      y: number;
      sizeRatio: number;
      scale: number;
      rotation: number;
      opacity?: number;
      source: "asset" | "url";
      assetId?: string;
      url?: string;
    };

export type StoryItem = {
  url?: string;
  thumbnail?: string;
  type: StoryItemType;
  mimeType?: string;
  livePhotoVideoUrl?: string;
  duration: number;
  visibility?: "public" | "close_friends";
  text?: string;
  textColor?: string;
  backgroundColor?: string;
  animatedGifOverlays?: StoryAnimatedGifOverlay[];
  storyOverlays?: StoryOverlay[];
  header: {
    heading: string;
    subheading: string;
    profileImage: string;
  };
};

export type Story = {
  id: string;
  userId?: string;
  username: string;
  avatar: string;
  hasStory?: boolean;
  isViewed: boolean;
  isYou?: boolean;
  hasCloseFriendsStory?: boolean;
  stories?: StoryItem[];
  items?: Array<{
    id?: string;
    type: StoryItemType;
    url?: string;
    thumbnail?: string;
    mimeType?: string;
    livePhotoVideoUrl?: string;
    text?: string;
    textColor?: string;
    backgroundColor?: string;
    animatedGifOverlays?: StoryAnimatedGifOverlay[];
    storyOverlays?: StoryOverlay[];
    duration?: number;
    visibility?: "public" | "close_friends";
  }>;
};

export type Conversation = {
  id: string;
  user: {
    name: string;
    username: string;
    avatar: string;
  };
  lastMessage: string;
  timestamp: string;
  unread: boolean;
};

export type Message = {
  id: string;
  text: string;
  sender: "user" | "other";
  timestamp: string;
  media?: { type: "image" | "video"; url: string }[];
};
