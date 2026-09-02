import { useEffect, useRef, useState } from 'react';

type RoundTimerOptions = {
  endsAt: number | null;
  active: boolean;
  onExpire: () => void;
  onSecond?: (remainingSeconds: number) => void;
};

export function useRoundTimer({ endsAt, active, onExpire, onSecond }: RoundTimerOptions) {
  const [tick, setTick] = useState(() => ({ endsAt, remaining: getRemainingSeconds(endsAt) }));
  const onExpireRef = useRef(onExpire);
  const onSecondRef = useRef(onSecond);

  useEffect(() => {
    onExpireRef.current = onExpire;
    onSecondRef.current = onSecond;
  }, [onExpire, onSecond]);

  useEffect(() => {
    if (!active || !endsAt) return;

    return scheduleRoundTimer(endsAt, (remaining) => setTick({ endsAt, remaining }));
  }, [active, endsAt]);

  // Read state, not Date.now() with an unchanged deadline: React Compiler can
  // memoize that calculation and leave the text on 3 while callbacks keep firing.
  const remaining = tick.endsAt === endsAt ? tick.remaining : getRemainingSeconds(endsAt);
  const delivered = useRef<{ endsAt: number; remaining: number } | null>(null);
  useEffect(() => {
    if (!active || endsAt === null || tick.endsAt !== endsAt) return;
    if (delivered.current?.endsAt === endsAt && delivered.current.remaining === remaining) return;
    delivered.current = { endsAt, remaining };
    // Deliver cues from the same committed value used by the visible number.
    onSecondRef.current?.(remaining);
    if (remaining === 0) onExpireRef.current();
  }, [active, endsAt, remaining, tick.endsAt]);
  return remaining;
}

export function scheduleRoundTimer(endsAt: number, onTick: (remaining: number) => void) {
  let cancelled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    if (cancelled) return;
    const remaining = getRemainingSeconds(endsAt);
    onTick(remaining);
    if (remaining > 0 && !cancelled) {
      timeout = setTimeout(update, getNextSecondBoundaryDelay(endsAt, remaining));
    }
  };
  update();
  return () => {
    cancelled = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}

export function getRemainingSeconds(endsAt: number | null, now = Date.now()) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function getRemainingSecondsFromMs(remainingMs: number | null) {
  if (remainingMs === null) return 0;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

export function getNextSecondBoundaryDelay(
  endsAt: number,
  remainingSeconds: number,
  now = Date.now(),
) {
  const nextBoundaryAt = endsAt - (remainingSeconds - 1) * 1000;
  return Math.max(1, nextBoundaryAt - now);
}
