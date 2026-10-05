import { buildFlightRecorderTraceText, recordFlightEvent } from '@/utils/flight-recorder';

type Value = string | number | boolean | null;
export const SHAREPLAY_RUNTIME_REVISION = 'pass-n-play-v5';
// Only these metadata fields may enter the persistent trace. Never record wire bodies,
// card text, purchase records, signing keys, or invitation nonces.
const allowed = new Set(['status', 'session', 'participant', 'members', 'isHost', 'kind',
  'bytes', 'recipients', 'code', 'result', 'phase', 'revision', 'ready', 'deckCount',
  'parts', 'part', 'synchronized', 'foreground', 'accepted', 'attempt', 'source']);
const repeated = new Map<string, number>();

export function shortSharePlayId(id: string | null | undefined) {
  return id ? id.slice(-8) : 'none';
}

export function logSharePlay(stage: string, details: Record<string, Value> = {}, warning = false) {
  // Repeated transport failures otherwise flood the development console and
  // force the persistent recorder to write on every dropped packet.
  if (warning || stage.startsWith('native.message.') || stage === 'clock.reply') {
    const key = `${stage}:${details.code ?? ''}:${details.kind ?? ''}`;
    const now = performance.now();
    if (now - (repeated.get(key) ?? -Infinity) < 5_000) return;
    if (repeated.size >= 128 && !repeated.has(key)) repeated.delete(repeated.keys().next().value!);
    repeated.set(key, now);
  }
  const safe: Record<string, Value> = {};
  for (const [key, value] of Object.entries(details)) {
    if (allowed.has(key)) safe[key] = typeof value === 'string' ? value.slice(0, 48) : value;
  }
  const name = `shareplay.${stage.replace(/[^a-zA-Z0-9.-]/g, '').slice(0, 64)}`;
  recordFlightEvent(name, safe, { flush: warning, level: warning ? 'warn' : 'info' });
  if (__DEV__) {
    if (warning) console.warn(`[SharePlay] ${name}`, safe);
    else console.info(`[SharePlay] ${name}`, safe);
  }
}

export function sharePlayTraceText() {
  return buildFlightRecorderTraceText('shareplay.', 120);
}
