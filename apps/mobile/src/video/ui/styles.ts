/**
 * Video Chat NativeWind Design Tokens
 * Shared className strings for consistent styling
 */

export const c = {
  // Cards & Containers
  card: "bg-card rounded-2xl border border-border overflow-hidden",
  cardGlass:
    "bg-card/80 backdrop-blur-xl rounded-2xl border border-border/50 overflow-hidden",

  // Pills & Badges
  pill: "px-3 py-1.5 rounded-full bg-muted",
  pillActive: "px-3 py-1.5 rounded-full bg-primary",
  badge: "px-2 py-0.5 rounded-full text-xs font-medium",
  badgeHost: "bg-amber-500/20 text-amber-500",
  badgeMod: "bg-blue-500/20 text-blue-500",
  badgeParticipant: "bg-muted text-muted-foreground",

  // Buttons
  btnPrimary:
    "bg-primary px-6 py-3 rounded-full items-center justify-center active:opacity-80",
  btnSecondary:
    "bg-secondary px-6 py-3 rounded-full items-center justify-center active:opacity-80",
  btnGhost:
    "px-4 py-2 rounded-full items-center justify-center active:bg-muted",
  btnDestructive:
    "bg-destructive px-6 py-3 rounded-full items-center justify-center active:opacity-80",
  btnIcon:
    "w-12 h-12 rounded-full items-center justify-center bg-muted/80 active:bg-muted",
  btnIconActive:
    "w-12 h-12 rounded-full items-center justify-center bg-primary active:opacity-80",
  btnIconDestructive:
    "w-12 h-12 rounded-full items-center justify-center bg-destructive active:opacity-80",

  // Video Tiles
  videoTile: "rounded-2xl overflow-hidden bg-muted relative",
  videoTileSmall: "w-24 h-32 rounded-xl overflow-hidden bg-muted relative",
  videoTileLarge: "flex-1 rounded-2xl overflow-hidden bg-muted relative",
  videoOverlay:
    "absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/60 to-transparent",
  videoNamePill: "px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm",
  videoStatusBadge: "w-6 h-6 rounded-full items-center justify-center",

  // Controls Bar
  controlsBar:
    "flex-row items-center justify-center gap-4 px-6 py-4 bg-card/90 backdrop-blur-xl rounded-full border border-border/50",
  controlsBarFloating:
    "absolute bottom-8 left-4 right-4 flex-row items-center justify-center gap-4 px-6 py-4 bg-card/90 backdrop-blur-xl rounded-full border border-border/50",

  // Lists
  listItem: "flex-row items-center px-4 py-3 gap-3 active:bg-muted/50",
  listItemBorder:
    "flex-row items-center px-4 py-3 gap-3 border-b border-border active:bg-muted/50",

  // Typography
  textTitle: "text-xl font-bold text-foreground",
  textSubtitle: "text-base font-semibold text-foreground",
  textBody: "text-sm text-foreground",
  textMuted: "text-sm text-muted-foreground",
  textSmall: "text-xs text-muted-foreground",

  // Avatars
  avatarSm: "w-8 h-8 rounded-xl bg-muted",
  avatarMd: "w-10 h-10 rounded-xl bg-muted",
  avatarLg: "w-14 h-14 rounded-xl bg-muted",
  avatarXl: "w-20 h-20 rounded-xl bg-muted",

  // Status indicators
  statusOnline: "w-3 h-3 rounded-full bg-green-500",
  statusOffline: "w-3 h-3 rounded-full bg-muted-foreground",
  statusBusy: "w-3 h-3 rounded-full bg-red-500",

  // Modals & Sheets
  modalOverlay: "absolute inset-0 bg-black/60",
  modalContent: "bg-card rounded-t-3xl p-6",
  sheetHandle: "w-10 h-1 rounded-full bg-muted-foreground/30 self-center mb-4",

  // Connection states
  connectionBanner:
    "flex-row items-center justify-center gap-2 px-4 py-2 rounded-full",
  connectionConnecting: "bg-amber-500/20",
  connectionReconnecting: "bg-amber-500/20",
  connectionError: "bg-destructive/20",
  connectionPoor: "bg-amber-500/20",

  // Empty states
  emptyState: "flex-1 items-center justify-center p-8",
  emptyIcon: "w-16 h-16 text-muted-foreground mb-4",

  // Skeletons
  skeleton: "bg-muted animate-pulse rounded",
  skeletonCircle: "bg-muted animate-pulse rounded-full",
} as const;

export const colors = {
  host: "#f59e0b",
  moderator: "#3b82f6",
  participant: "#6b7280",
  online: "#22c55e",
  offline: "#6b7280",
  muted: "#ef4444",
  speaking: "#22c55e",
};
