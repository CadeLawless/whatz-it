import { readFileSync } from 'node:fs';

type Entry = { stage: string; at: number; data?: Record<string, unknown> };
type Report = { nativeSamples: number[][]; js: { clockUncertaintyMs: number; entries: Entry[] } };
const path = process.argv[2];
if (!path) throw new Error('Usage: npx tsx scripts/analyze-android-gameplay-trace.ts <trace.json>');
const report: Report = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const entries = report.js.entries;
function stats(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2) : null;
  return { count: sorted.length, medianMs: at(.5), p95Ms: at(.95), maxMs: at(1) };
}
const receipts = entries.filter(e => e.stage === 'sensor.js-receipt');
const classified = entries.filter(e => e.stage === 'sensor.classified');
const gestures = entries.filter(e => e.stage === 'gesture.accepted').map(accepted => {
  const id = accepted.data?.gesture;
  const same = entries.filter(e => e.data?.gesture === id && e.at >= accepted.at);
  const offset = (stage: string) => {
    const event = same.find(e => e.stage === stage && (stage !== 'react.layout-effect' || e.data?.status === 'feedback'));
    return event ? +(event.at - accepted.at).toFixed(2) : null;
  };
  const sampleIndex = classified.findLastIndex(e => e.at <= accepted.at);
  const sample = classified[sampleIndex];
  const rawDelta = (entry: Entry) => {
    const delta = Number(entry.data?.raw) - Number(entry.data?.baseline);
    return Math.atan2(Math.sin(delta), Math.cos(delta));
  };
  const action = sample?.data?.action;
  const direction = action === 'correct' ? 1 : -1;
  let candidateIndex = sampleIndex;
  while (candidateIndex > 0 && classified[candidateIndex - 1].data?.candidate === action) candidateIndex--;
  let crossingIndex = sampleIndex;
  // Find the most recent outward excursion, including a filter-tail acceptance
  // whose current raw angle has already returned below the trigger.
  while (crossingIndex > 0 && rawDelta(classified[crossingIndex]) * direction < .48 && sample.at - classified[crossingIndex].at < 1000) crossingIndex--;
  while (crossingIndex > 0 && rawDelta(classified[crossingIndex - 1]) * direction >= .48) crossingIndex--;
  return {
    gesture: id,
    acceptedRaw: sample?.data?.raw, acceptedFiltered: sample?.data?.filtered,
    acceptedRawDelta: sample ? +rawDelta(sample).toFixed(3) : null,
    rawCrossingToAcceptedMs: sample && rawDelta(classified[crossingIndex]) * direction >= .48
      ? +(accepted.at - classified[crossingIndex].at).toFixed(2) : null,
    candidateToAcceptedMs: sample ? +(accepted.at - classified[candidateIndex].at).toFixed(2) : null,
    sampleToAcceptedMs: sample ? +(accepted.at - Number(sample.data?.sampleMs)).toFixed(2) : null,
    callbackMs: offset('answerCard.enter'), dispatchMs: offset('reducer.dispatch'),
    commitMs: offset('react.layout-effect'), nextJsFrameMs: offset('js.next-frame'),
    audioRequestMs: offset('audio.request'), audioPlayReturnedMs: offset('audio.play-returned'),
    hapticRequestMs: offset('haptic.request'), hapticDispatchReturnedMs: offset('haptic.dispatch-returned'),
  };
});
console.log(JSON.stringify({
  clockUncertaintyMs: report.js.clockUncertaintyMs,
  nativeSampleToReceipt: stats(report.nativeSamples.map(s => s[1] - s[0])),
  sensorToJs: stats(receipts.map(e => e.at - Number(e.data?.sampleMs))),
  jsReceiptIntervals: stats(receipts.slice(1).map((e, i) => e.at - receipts[i].at)),
  stages: Object.fromEntries([
    'sampleToAcceptedMs', 'rawCrossingToAcceptedMs', 'candidateToAcceptedMs', 'callbackMs', 'dispatchMs',
    'commitMs', 'nextJsFrameMs', 'audioRequestMs', 'audioPlayReturnedMs', 'hapticRequestMs', 'hapticDispatchReturnedMs',
  ].map(key => [key, stats(gestures.map(g => g[key as keyof typeof g]).filter((v): v is number => typeof v === 'number'))])),
  gestures,
  limitations: 'Layout effect and next JS rAF are commit/frame proxies, not display photons. Audio play and vibration dispatch are API stages, not physical onset.',
}, null, 2));
