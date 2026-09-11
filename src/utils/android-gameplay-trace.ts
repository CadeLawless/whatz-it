import { Platform } from 'react-native';
import { androidGameplayTrace } from 'whatz-it-video-export';

type Entry = { stage: string; at: number; data?: Record<string, unknown> };
let entries: Entry[] | null = null;
let nativeOffset = 0;
let clockUncertaintyMs = 0;
let gesture = 0;

export function startAndroidGameplayTrace() {
  if (Platform.OS !== 'android') return;
  const before = performance.now();
  const native = androidGameplayTrace.clock();
  const after = performance.now();
  if (native === null) return;
  nativeOffset = native - (before + after) / 2;
  clockUncertaintyMs = (after - before) / 2;
  entries = [];
  gesture = 0;
  androidGameplayTrace.start();
  traceAndroidGameplay('trace.start', { clockUncertaintyMs });
}

// Memory only in the hot path: no console, disk writes, native getters or
// promise chains per sample. Physical motor/speaker onset is NOT measured.
export function traceAndroidGameplay(stage: string, data?: Record<string, unknown>) {
  if (!entries || entries.length >= 20_000) return;
  entries.push({ stage, at: performance.now() + nativeOffset, data: { gesture, ...data } });
}

export function traceAndroidGesture() {
  if (!entries) return;
  gesture++;
  traceAndroidGameplay('gesture.accepted');
}

export function traceAndroidCommit(status: string, card: number) {
  if (!entries) return;
  traceAndroidGameplay('react.layout-effect', { status, card });
  const currentEntries = entries;
  const currentGesture = gesture;
  requestAnimationFrame(() => {
    if (entries === currentEntries) traceAndroidGameplay('js.next-frame', { status, card, gesture: currentGesture });
  });
}

export function stopAndroidGameplayTrace() {
  if (!entries) return;
  traceAndroidGameplay('trace.stop');
  const captured = entries;
  entries = null;
  androidGameplayTrace.stop();
  // Serialization and native file writing only after input has stopped.
  void androidGameplayTrace.save(JSON.stringify({ clockUncertaintyMs, entries: captured }))?.catch(() => {
    // Diagnostic persistence must never affect leaving a round.
  });
}
