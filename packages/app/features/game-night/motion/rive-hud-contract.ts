/**
 * Authored Rive contract for the Game Night HUD.
 *
 * This file intentionally has no Rive runtime import. The repository does not
 * yet contain the authored .riv binary, so UI code can ship a complete
 * accessible fallback without pretending an animation asset exists. When the
 * asset lands, the runtime adapter can bind these exact names.
 */
export const GAME_NIGHT_RIVE_HUD = {
  assetPath: "/rive/game-night-hud.riv",
  artboards: {
    score: "Score HUD",
    leaderboard: "Leaderboard",
    button: "Game Button",
    result: "Match Result",
    roomReactions: "Room Reactions",
  },
  stateMachine: "DVNT HUD",
  roomReactionStateMachine: "Room Reactions",
  inputs: {
    score: "score",
    targetScore: "targetScore",
    rank: "rank",
    playerCount: "playerCount",
    isLeader: "isLeader",
    isWinner: "isWinner",
    isMe: "isMe",
    disabled: "disabled",
    pressed: "pressed",
    celebrate: "celebrate",
    ctaKind: "ctaKind",
    reactionKind: "reactionKind",
    burst: "burst",
    isSelf: "isSelf",
    lane: "lane",
    seatIndex: "seatIndex",
    intensity: "intensity",
  },
} as const;

export type GameNightRiveButtonKind =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost";

export function riveButtonKindValue(kind: GameNightRiveButtonKind): number {
  switch (kind) {
    case "primary":
      return 0;
    case "secondary":
      return 1;
    case "danger":
      return 2;
    case "ghost":
      return 3;
  }
}

export function scoreHudBindings({
  score,
  targetScore,
  rank,
  playerCount,
  isLeader,
  isWinner,
  isMe,
}: {
  score: number;
  targetScore: number;
  rank: number;
  playerCount: number;
  isLeader: boolean;
  isWinner: boolean;
  isMe: boolean;
}) {
  return {
    score: Math.max(0, score),
    targetScore: Math.max(1, targetScore),
    rank: Math.max(1, rank),
    playerCount: Math.max(1, playerCount),
    isLeader,
    isWinner,
    isMe,
  };
}
