import { useEffect, useRef, useState } from 'react';

type RoundTimerOptions = {
  endsAt: number | null;
  active: boolean;
  onExpire: () => void;
  onSecond?: (remainingSeconds: number) => void;
};

export function useRoundTimer({ endsAt, active, onExpire, onSecond }: RoundTimerOptions) {
  const [remainingSeconds, setRemainingSeconds] = useState(() => getRemainingSeconds(endsAt));
  const onExpireRef = useRef(onExpire);
  const onSecondRef = useRef(onSecond);

  useEffect(() => {
    onExpireRef.current = onExpire;
    onSecondRef.current = onSecond;
  }, [onExpire, onSecond]);

  useEffect(() => {
    if (!active || !endsAt) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let previousRemaining: number | null = null;
    let expired = false;

    const update = () => {
      const now = Date.now();
      const remaining = getRemainingSeconds(endsAt, now);
      setRemainingSeconds(remaining);
      if (remaining !== previousRemaining) {
        previousRemaining = remaining;
        onSecondRef.current?.(remaining);
      }
      if (remaining === 0) {
        if (!expired) {
          expired = true;
          onExpireRef.current();
        }
        return;
      }

      // Schedule against the absolute round end instead of repeatedly polling.
      // This keeps each second boundary independent, so a delayed callback does
      // not introduce cumulative drift into the rest of the countdown.
      timeout = setTimeout(
        update,
        getNextSecondBoundaryDelay(endsAt, remaining, Date.now()),
      );
    };

    update();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [active, endsAt]);

  return active ? remainingSeconds : getRemainingSeconds(endsAt);
}

export function getRemainingSeconds(endsAt: number | null, now = Date.now()) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export function getNextSecondBoundaryDelay(
  endsAt: number,
  remainingSeconds: number,
  now = Date.now(),
) {
  const nextBoundaryAt = endsAt - (remainingSeconds - 1) * 1000;
  return Math.max(1, nextBoundaryAt - now);
}
