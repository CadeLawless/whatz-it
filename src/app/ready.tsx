import { useState } from 'react';

import ClassicReadyScreen from '@/components/classic-ready-screen';
import { PassNPlayReadyScreen } from '@/components/pass-n-play-ready-screen';
import { useRound } from '@/game/round-context';

export default function ReadyScreen() {
  const { round } = useRound();
  // Resetting on cancel must not mount the other mode before navigation finishes.
  const [mode] = useState(round.mode);
  return mode === 'pass-n-play'
    ? <PassNPlayReadyScreen />
    : <ClassicReadyScreen />;
}
