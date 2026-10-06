import type { RemoteCard, RemoteIntent, RemoteView } from './remote-round';
import type { GameMode } from '../game/game-types';
import { canSeeSharePlayAnswer } from './round-roles';

export type GameControl =
  | { action: 'select-guesser'; participantId: string }
  | { action: 'select-deck'; deckId: string }
  | { action: 'select-mode'; mode: GameMode }
  | { action: 'select-duration'; seconds: number }
  | { action: 'next-round' | 'return-to-lobby' | 'end-game' };

export type GameWire =
  | { version: 3; kind: 'view'; view: RemoteView; hostTime: number }
  | { version: 3; kind: 'intent'; intent: RemoteIntent }
  | { version: 3; kind: 'snapshot-request' | 'inventory-request' }
  | { version: 3; kind: 'host-claim'; term?: number }
  | { version: 3; kind: 'host-transfer'; targetId: string; term?: number }
  | { version: 3; kind: 'session-end'; term: number }
  | { version: 3; kind: 'presence'; active: boolean; sequence: number }
  | { version: 3; kind: 'deck-selection'; deckId: string | null; durationSeconds: number; hostTime: number; inLobby: boolean; mode?: GameMode }
  | ({ version: 3; kind: 'control'; roundId: string; revision: number } & GameControl)
  | { version: 3; kind: 'clock'; nonce: string }
  | { version: 3; kind: 'clock-reply'; nonce: string; received: number; sent: number }
  | { version: 3; kind: 'inventory'; generation: string; index: number; total: number; deckIds: string[] }
  | { version: 3; kind: 'deck-request'; requestId: string; deckId: string }
  | { version: 3; kind: 'deck-cards'; requestId: string; deckId: string; contentHash: string; cards: RemoteCard[] };

const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
const card = (value: unknown): value is { answer: string; byline: string } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return exact(item, ['answer', 'byline']) && typeof item.answer === 'string' &&
    item.answer.length > 0 && item.answer.length <= 256 &&
    typeof item.byline === 'string' && item.byline.length <= 256;
};

/** Only views from the transport-authenticated current host may be passed here. */
export function parseRemoteView(value: unknown, sessionId: string, recipientId: string): RemoteView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const participants = Array.isArray(v.participants) ? v.participants : [];
  if (!exact(v, ['sessionId', 'roundId', 'revision', 'phase', 'hostId', 'guesserId',
    'participants', 'ready', 'deck', 'durationSeconds', 'startsAt', 'deadline',
    'remainingMs', 'score', 'canAnswer', 'cardNonce', 'card', 'feedback', 'resultReason', 'results',
    ...(v.mode === undefined ? [] : ['mode'])]) ||
    (v.mode !== undefined && !['classic', 'pass-n-play'].includes(String(v.mode))) ||
    v.sessionId !== sessionId || !id(v.roundId) || !id(v.hostId) || !id(v.guesserId) ||
    !Number.isSafeInteger(v.revision) || (v.revision as number) < 0 ||
    !['lobby', 'countdown', 'playing', 'feedback', 'paused', 'results', 'ended'].includes(String(v.phase)) ||
    !Array.isArray(v.participants) || participants.length < 1 ||
    !participants.every(id) || new Set(participants).size !== participants.length ||
    !participants.includes(recipientId) || !participants.includes(v.hostId) ||
    !participants.includes(v.guesserId) ||
    !Number.isInteger(v.durationSeconds) || (v.durationSeconds as number) < 30 || (v.durationSeconds as number) > 300 ||
    !Array.isArray(v.ready) || !v.ready.every((member: unknown) => id(member) && participants.includes(member)) ||
    !v.deck || typeof v.deck !== 'object' || Array.isArray(v.deck) ||
    !exact(v.deck as Record<string, unknown>, ['deckId', 'contentHash', 'sponsorId']) ||
    !id((v.deck as Record<string, unknown>).deckId) ||
    !/^[a-f0-9]{64}$/.test(String((v.deck as Record<string, unknown>).contentHash)) ||
    !id((v.deck as Record<string, unknown>).sponsorId) ||
    !(v.startsAt === null || finite(v.startsAt)) || !(v.deadline === null || finite(v.deadline)) ||
    !finite(v.remainingMs) || v.remainingMs > 300_000 ||
    !Number.isSafeInteger(v.score) || (v.score as number) < 0 ||
    typeof v.canAnswer !== 'boolean' || !(v.cardNonce === null || id(v.cardNonce)) ||
    !(v.card === null || card(v.card)) ||
    ![null, 'correct', 'pass'].includes(v.feedback as null | string) ||
    (v.phase === 'results' ? !['time', 'cards', 'players'].includes(String(v.resultReason)) : v.resultReason !== null) ||
    !(v.results === null || (Array.isArray(v.results) && v.results.length <= 20 &&
      v.results.every((item: unknown) => !!item && typeof item === 'object' &&
        exact(item as Record<string, unknown>, ['answer', 'byline', 'outcome']) &&
        card({ answer: (item as Record<string, unknown>).answer, byline: (item as Record<string, unknown>).byline }) &&
        ['correct', 'pass', 'neutral'].includes(String((item as Record<string, unknown>).outcome)))))) return null;
  if (!canSeeSharePlayAnswer(v.mode as GameMode | undefined, recipientId, v.guesserId as string) &&
    v.card !== null) return null;
  if (recipientId !== v.guesserId && (v.cardNonce !== null || v.canAnswer !== false)) return null;
  if (v.phase === 'playing' && recipientId === v.guesserId &&
    (v.canAnswer !== true || !id(v.cardNonce))) return null;
  if (v.phase !== 'results' && v.results !== null) return null;
  if (v.phase !== 'playing' &&
    (v.card !== null || v.cardNonce !== null || v.canAnswer !== false)) return null;
  return v as RemoteView;
}

export function parseGameWire(body: string): GameWire | null {
  if (body.length > 16_384) return null;
  try {
    const raw: unknown = JSON.parse(body);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    if (v.version !== 3) return null;
    if (v.kind === 'view') {
      if (!exact(v, ['version', 'kind', 'view', 'hostTime']) || !finite(v.hostTime)) return null;
    } else if (v.kind === 'intent') {
      if (!exact(v, ['version', 'kind', 'intent']) || !v.intent || typeof v.intent !== 'object') return null;
    } else if (v.kind === 'snapshot-request' || v.kind === 'inventory-request') {
      if (!exact(v, ['version', 'kind'])) return null;
    } else if (v.kind === 'host-claim') {
      if (!exact(v, v.term === undefined ? ['version', 'kind'] : ['version', 'kind', 'term']) ||
        (v.term !== undefined && (!Number.isSafeInteger(v.term) || (v.term as number) < 0))) return null;
    } else if (v.kind === 'presence') {
      if (!exact(v, ['version', 'kind', 'active', 'sequence']) || typeof v.active !== 'boolean' ||
        !Number.isSafeInteger(v.sequence) || (v.sequence as number) < 0) return null;
    } else if (v.kind === 'session-end') {
      if (!exact(v, ['version', 'kind', 'term']) || !Number.isSafeInteger(v.term) ||
        (v.term as number) < 0) return null;
    } else if (v.kind === 'host-transfer') {
      if (!exact(v, v.term === undefined ? ['version', 'kind', 'targetId'] : ['version', 'kind', 'targetId', 'term']) ||
        !id(v.targetId) || (v.term !== undefined && (!Number.isSafeInteger(v.term) || (v.term as number) < 0))) return null;
    } else if (v.kind === 'deck-selection') {
      if (!exact(v, ['version', 'kind', 'deckId', 'durationSeconds', 'hostTime', 'inLobby',
        ...(v.mode === undefined ? [] : ['mode'])]) ||
        (v.mode !== undefined && !['classic', 'pass-n-play'].includes(String(v.mode))) ||
        !(v.deckId === null || id(v.deckId)) || !finite(v.hostTime) ||
        typeof v.inLobby !== 'boolean' ||
        !Number.isInteger(v.durationSeconds) || (v.durationSeconds as number) < 30 ||
        (v.durationSeconds as number) > 300) return null;
    } else if (v.kind === 'control') {
      if (!id(v.roundId) || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0) return null;
      if (v.action === 'select-guesser') {
        if (!exact(v, ['version', 'kind', 'action', 'roundId', 'revision', 'participantId']) || !id(v.participantId)) return null;
      } else if (v.action === 'select-deck') {
        if (!exact(v, ['version', 'kind', 'action', 'roundId', 'revision', 'deckId']) || !id(v.deckId)) return null;
      } else if (v.action === 'select-mode') {
        if (!exact(v, ['version', 'kind', 'action', 'roundId', 'revision', 'mode']) || !['classic', 'pass-n-play'].includes(String(v.mode))) return null;
      } else if (v.action === 'select-duration') {
        if (!exact(v, ['version', 'kind', 'action', 'roundId', 'revision', 'seconds']) ||
          !Number.isInteger(v.seconds) || (v.seconds as number) < 30 || (v.seconds as number) > 300) return null;
      } else if (!['next-round', 'return-to-lobby', 'end-game'].includes(String(v.action)) ||
        !exact(v, ['version', 'kind', 'action', 'roundId', 'revision'])) return null;
    } else if (v.kind === 'clock') {
      if (!exact(v, ['version', 'kind', 'nonce']) || !id(v.nonce)) return null;
    } else if (v.kind === 'clock-reply') {
      if (!exact(v, ['version', 'kind', 'nonce', 'received', 'sent']) ||
        !id(v.nonce) || !finite(v.received) || !finite(v.sent) || v.sent < v.received) return null;
    } else if (v.kind === 'inventory') {
      if (!exact(v, ['version', 'kind', 'generation', 'index', 'total', 'deckIds']) ||
        !id(v.generation) || !Number.isInteger(v.index) || !Number.isInteger(v.total) ||
        (v.total as number) < 1 || (v.total as number) > 20 ||
        (v.index as number) < 0 || (v.index as number) >= (v.total as number) ||
        !Array.isArray(v.deckIds) || v.deckIds.length > 80 || !v.deckIds.every(id)) return null;
    } else if (v.kind === 'deck-request') {
      if (!exact(v, ['version', 'kind', 'requestId', 'deckId']) || !id(v.requestId) || !id(v.deckId)) return null;
    } else if (v.kind === 'deck-cards') {
      if (!exact(v, ['version', 'kind', 'requestId', 'deckId', 'contentHash', 'cards']) ||
        !id(v.requestId) || !id(v.deckId) || !/^[a-f0-9]{64}$/.test(String(v.contentHash)) ||
        !Array.isArray(v.cards) || v.cards.length < 1 || v.cards.length > 20 ||
        !v.cards.every(card)) return null;
    } else return null;
    return v as GameWire;
  } catch { return null; }
}
