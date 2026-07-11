import { useEffect, useState } from 'react';

type RoundTimerOptions = {
  endsAt: number | null;
  active: boolean;
  onExpire: () => void;
};

export function useRoundTimer({ endsAt, active, onExpire }: RoundTimerOptions) {
  const [remainingSeconds, setRemainingSeconds] = useState(() => getRemainingSeconds(endsAt));

  useEffect(() => {
    if (!active || !endsAt) return;

    const update = () => {
      const remaining = getRemainingSeconds(endsAt);
      setRemainingSeconds(remaining);
      if (remaining === 0) onExpire();
    };

    update();
    const interval = setInterval(update, 200);
    return () => clearInterval(interval);
  }, [active, endsAt, onExpire]);

  return active ? remainingSeconds : getRemainingSeconds(endsAt);
}

export function getRemainingSeconds(endsAt: number | null, now = Date.now()) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}
