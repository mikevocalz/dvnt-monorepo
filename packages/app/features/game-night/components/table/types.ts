export type TableState =
  | "lobby"
  | "submitting"
  | "judging"
  | "results"
  | "duel";

export interface TableCard {
  card_id: string;
  text: string;
}

export interface TableReveal {
  submission_id: number;
  texts: string[];
  is_winner?: boolean;
}

export interface TableMember {
  user_id: string;
  name: string;
  avatar: string;
  seat_no: number;
}

export interface GameTableProps {
  state: TableState;
  prompt: { text: string; pick: number };
  myHand: TableCard[];
  selected: string[];
  submissionsIn: number;
  submissionsExpected: number;
  reveal: TableReveal[] | null;
  members: TableMember[];
  myUserId: string;
  judgeUserId?: string;
  onSelectCard(id: string): void;
  onPickWinner(submissionId: number): void;
  onDuelPick?(cardId: string): void;
  duelOptions?: TableCard[];
  /** When false the canvas is display-only — callers that render semantic
      HTML controls alongside the scene (the web room) pass false so each
      action has exactly one interactive surface. */
  interactive?: boolean;
}
