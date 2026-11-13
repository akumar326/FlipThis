import type { BankId, DrumRow, KitId, LaneId, Phase, SlotId } from './config';
import type { BotProfile } from './bots';
import type { SongPreview } from './songs';

/** A beat is plain data so it can be synced, voted on and flipped. */
export interface Beat {
  /** lane -> zero-based arrangement bar index -> loop id */
  place: Record<LaneId, Record<string, string>>;
  drumOn: boolean[];
  kit: KitId;
  steps: Record<DrumRow, number[]>;
}

export interface Taste { song: string; tags: string[]; preview?: SongPreview }

export interface FlipState {
  /** Whose beat this player is flipping. */
  of: SlotId;
  beat: Beat;
  edits: number;
  done: boolean;
}

export interface PlayerState {
  name: string;
  joinedAt: number;
  bank?: BankId;
  taste?: Taste;
  sampleReady?: boolean;
  beat?: Beat;
  submitted?: boolean;
  /** pair key ("p1-p2") -> winning slot */
  votes?: Record<string, SlotId>;
  /** One editable comment per reviewed creator, saved alongside votes. */
  comments?: Partial<Record<SlotId, string>>;
  flip?: FlipState;
  teamUp?: boolean | null;
  /** Demo player filled in by the host when rehearsing without enough people. */
  bot?: boolean;
  botProfile?: BotProfile;
  demoTasteVersion?: number;
}

export interface VotingState {
  slots: SlotId[];
  beats: Partial<Record<SlotId, Beat>>;
  schedule: Partial<Record<SlotId, [SlotId, SlotId][]>>;
}

export interface RoomState {
  lobby?: { code: string; name: string; hostName: string; createdAt: number };
  chat?: Record<string, ChatMessage>;
  chatSequence?: number;
  botChatState?: { phase: Phase; sent: number; nextAt: number };
  crewChats?: Record<string, { chat: Record<string, ChatMessage>; chatSequence: number }>;
  battle?: BattleSetup;
  voting?: VotingState;
  phase: Phase;
  /** Epoch ms when the current phase timer ends, or null for no timer. */
  phaseEndsAt: number | null;
  players: Partial<Record<SlotId, PlayerState>>;
  /** slot -> whose beat they remix; reciprocal pairs or a three-player circle */
  pairs: Partial<Record<SlotId, SlotId>> | null;
  updatedAt: number;
}

export interface ChatMessage {
  bot?: boolean;
  id: string;
  author: SlotId | 'host';
  name: string;
  text: string;
  phase: Phase;
  sequence: number;
  createdAt: number;
}

export interface BattleSetup {
  id: string;
  sampleId: string;
  /** Legacy sample rotation; empty for new battles using the original vocal chop. */
  sampleQueue: string[];
  packs: Record<SlotId, BankId>;
}

export const EMPTY_ROOM: RoomState = { phase: 'lobby', phaseEndsAt: null, players: {}, pairs: null, updatedAt: 0 };
