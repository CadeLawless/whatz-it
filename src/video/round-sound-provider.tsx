import {
  type AudioPlayer,
  setIsAudioActiveAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';

import {
  getRoundSoundSource,
  playRoundSound,
  rewindRoundSoundPlayer,
  type RoundSoundId,
} from '@/video/round-sounds';

const PLAYER_OPTIONS = {
  downloadFirst: true,
  keepAudioSessionActive: true,
  updateInterval: 100,
} as const;

type RoundSoundContextValue = {
  isReady: boolean;
  play: (sound: RoundSoundId) => Promise<boolean>;
  prepareForRound: () => Promise<boolean>;
};

const RoundSoundContext = createContext<RoundSoundContextValue | null>(null);

export function RoundSoundProvider({ children }: PropsWithChildren) {
  const getReady = useAudioPlayer(getRoundSoundSource('get-ready'), PLAYER_OPTIONS);
  const count3 = useAudioPlayer(getRoundSoundSource('count-3'), PLAYER_OPTIONS);
  const count2 = useAudioPlayer(getRoundSoundSource('count-2'), PLAYER_OPTIONS);
  const count1 = useAudioPlayer(getRoundSoundSource('count-1'), PLAYER_OPTIONS);
  const roundStart = useAudioPlayer(getRoundSoundSource('round-start'), PLAYER_OPTIONS);
  const correct = useAudioPlayer(getRoundSoundSource('correct'), PLAYER_OPTIONS);
  const pass = useAudioPlayer(getRoundSoundSource('pass'), PLAYER_OPTIONS);
  const flip = useAudioPlayer(getRoundSoundSource('flip'), PLAYER_OPTIONS);
  const roundEnd = useAudioPlayer(getRoundSoundSource('round-end'), PLAYER_OPTIONS);

  // Each countdown tick gets its own already-loaded player. The tick WAV is
  // longer than one second, so reusing one player would seek it while it is
  // still playing and introduce native seek latency at every boundary.
  const tick1 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick2 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick3 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick4 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick5 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick6 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick7 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick8 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick9 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick10 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);

  const statuses = [
    useAudioPlayerStatus(getReady),
    useAudioPlayerStatus(count3),
    useAudioPlayerStatus(count2),
    useAudioPlayerStatus(count1),
    useAudioPlayerStatus(roundStart),
    useAudioPlayerStatus(correct),
    useAudioPlayerStatus(pass),
    useAudioPlayerStatus(flip),
    useAudioPlayerStatus(roundEnd),
    useAudioPlayerStatus(tick1),
    useAudioPlayerStatus(tick2),
    useAudioPlayerStatus(tick3),
    useAudioPlayerStatus(tick4),
    useAudioPlayerStatus(tick5),
    useAudioPlayerStatus(tick6),
    useAudioPlayerStatus(tick7),
    useAudioPlayerStatus(tick8),
    useAudioPlayerStatus(tick9),
    useAudioPlayerStatus(tick10),
  ];

  const regularPlayers = useMemo<Record<Exclude<RoundSoundId, 'final-tick'>, AudioPlayer>>(
    () => ({
      'get-ready': getReady,
      'count-3': count3,
      'count-2': count2,
      'count-1': count1,
      'round-start': roundStart,
      correct,
      pass,
      flip,
      'round-end': roundEnd,
    }),
    [count1, count2, count3, correct, flip, getReady, pass, roundEnd, roundStart],
  );
  const tickPlayers = useMemo(
    () => [tick1, tick2, tick3, tick4, tick5, tick6, tick7, tick8, tick9, tick10],
    [tick1, tick2, tick3, tick4, tick5, tick6, tick7, tick8, tick9, tick10],
  );
  const tickIndex = useRef(0);
  const isReady = statuses.every((status) => status.isLoaded && !status.error);

  const play = useCallback(
    (sound: RoundSoundId) => {
      if (sound !== 'final-tick') {
        if (sound === 'round-end') {
          // The tick file is 1.129 seconds long. Stop the final tail at the
          // round boundary so it cannot overlap the Time's Up sound.
          for (const player of tickPlayers) {
            if (player.playing) player.pause();
          }
        }
        return playRoundSound(regularPlayers[sound], sound);
      }
      const player = tickPlayers[tickIndex.current % tickPlayers.length];
      tickIndex.current += 1;
      return playRoundSound(player, sound);
    },
    [regularPlayers, tickPlayers],
  );

  const prepareForRound = useCallback(async () => {
    if (!isReady) return false;
    try {
      await setIsAudioActiveAsync(true);
      tickIndex.current = 0;
      const players = [...Object.values(regularPlayers), ...tickPlayers];
      const results = await Promise.all(players.map(rewindRoundSoundPlayer));
      return results.every(Boolean);
    } catch {
      return false;
    }
  }, [isReady, regularPlayers, tickPlayers]);

  const value = useMemo(
    () => ({ isReady, play, prepareForRound }),
    [isReady, play, prepareForRound],
  );
  return <RoundSoundContext.Provider value={value}>{children}</RoundSoundContext.Provider>;
}

export function useRoundSounds() {
  const context = useContext(RoundSoundContext);
  if (!context) throw new Error('useRoundSounds must be used inside RoundSoundProvider');
  return context;
}
