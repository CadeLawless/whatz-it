import ClassicGameScreen from '@/components/classic-game-screen';
import { PassNPlayGameScreen } from '@/components/pass-n-play-game-screen';
import { useRound } from '@/game/round-context';

export default function GameScreen() {
  const { round } = useRound();
  return round.mode === 'pass-n-play' ? <PassNPlayGameScreen /> : <ClassicGameScreen />;
}
