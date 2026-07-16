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
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getRoundSoundSource,
  playRoundSound,
  rewindRoundSoundPlayer,
  type RoundSoundId,
} from '@/video/round-sounds';
import { logRoundDiagnostic, warnRoundDiagnostic } from '@/video/video-diagnostics';

const PLAYER_OPTIONS = {
  keepAudioSessionActive: true,
  updateInterval: 100,
} as const;
const AUDIO_LOAD_TIMEOUT_MS = 10_000;

type RoundSoundContextValue = {
  isReady: boolean;
  loadTimedOut: boolean;
  play: (sound: RoundSoundId) => Promise<boolean>;
  prepareForRound: () => Promise<boolean>;
  retryLoading: () => void;
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

  // Alternating players give the 1.129-second tick enough time to finish before
  // that player is needed again two seconds later.
  const tick1 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);
  const tick2 = useAudioPlayer(getRoundSoundSource('final-tick'), PLAYER_OPTIONS);

  const getReadyStatus = useAudioPlayerStatus(getReady);
  const count3Status = useAudioPlayerStatus(count3);
  const count2Status = useAudioPlayerStatus(count2);
  const count1Status = useAudioPlayerStatus(count1);
  const roundStartStatus = useAudioPlayerStatus(roundStart);
  const correctStatus = useAudioPlayerStatus(correct);
  const passStatus = useAudioPlayerStatus(pass);
  const flipStatus = useAudioPlayerStatus(flip);
  const roundEndStatus = useAudioPlayerStatus(roundEnd);
  const tick1Status = useAudioPlayerStatus(tick1);
  const tick2Status = useAudioPlayerStatus(tick2);
  const namedStatuses = useMemo(
    () => [
      ['get-ready', getReadyStatus],
      ['count-3', count3Status],
      ['count-2', count2Status],
      ['count-1', count1Status],
      ['round-start', roundStartStatus],
      ['correct', correctStatus],
      ['pass', passStatus],
      ['flip', flipStatus],
      ['round-end', roundEndStatus],
      ['final-tick-a', tick1Status],
      ['final-tick-b', tick2Status],
    ] as const,
    [
      correctStatus,
      count1Status,
      count2Status,
      count3Status,
      flipStatus,
      getReadyStatus,
      passStatus,
      roundEndStatus,
      roundStartStatus,
      tick1Status,
      tick2Status,
    ],
  );

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
    () => [tick1, tick2],
    [tick1, tick2],
  );
  const tickIndex = useRef(0);
  const previousStatusKeys = useRef(new Map<string, string>());
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const isReady = namedStatuses.every(([, status]) => status.isLoaded && !status.error);
  const effectiveLoadTimedOut = loadTimedOut && !isReady;
  const readinessSignature = namedStatuses
    .map(([name, status]) => `${name}:${status.isLoaded}:${status.error ?? ''}`)
    .join('|');
  const getLoadSnapshot = useCallback(() => {
    const players: [string, AudioPlayer][] = [
      ...Object.entries(regularPlayers),
      ['final-tick-a', tickPlayers[0]],
      ['final-tick-b', tickPlayers[1]],
    ];
    return {
      failedPlayers: players
        .filter(([, player]) => player.currentStatus.error)
        .map(([name, player]) => ({ name, error: player.currentStatus.error })),
      loadedPlayers: players.filter(([, player]) => player.isLoaded).map(([name]) => name),
      pendingPlayers: players.filter(([, player]) => !player.isLoaded).map(([name]) => name),
    };
  }, [regularPlayers, tickPlayers]);

  useEffect(() => {
    logRoundDiagnostic('audio provider mounted', {
      playerCount: namedStatuses.length,
      loadTimeoutMs: AUDIO_LOAD_TIMEOUT_MS,
    });
    return () => logRoundDiagnostic('audio provider unmounted');
  }, [namedStatuses.length]);

  useEffect(() => {
    for (const [name, status] of namedStatuses) {
      const key = [
        status.isLoaded,
        status.isBuffering,
        status.playing,
        status.playbackState,
        status.timeControlStatus,
        status.reasonForWaitingToPlay,
        status.error,
        status.duration,
      ].join('|');
      if (previousStatusKeys.current.get(name) === key) continue;
      previousStatusKeys.current.set(name, key);
      logRoundDiagnostic('audio player status changed', {
        name,
        duration: status.duration,
        error: status.error,
        isBuffering: status.isBuffering,
        isLoaded: status.isLoaded,
        playbackState: status.playbackState,
        playing: status.playing,
        reasonForWaitingToPlay: status.reasonForWaitingToPlay,
        timeControlStatus: status.timeControlStatus,
      });
    }
  });

  useEffect(() => {
    const snapshot = getLoadSnapshot();
    logRoundDiagnostic('audio readiness changed', {
      isReady,
      ...snapshot,
    });
    if (isReady) return;
    const timeout = setTimeout(() => {
      setLoadTimedOut(true);
      warnRoundDiagnostic('audio loading timed out', new Error('Not all audio players loaded'), {
        pendingPlayers: getLoadSnapshot().pendingPlayers,
      });
    }, AUDIO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [getLoadSnapshot, isReady, readinessSignature]);

  useEffect(() => {
    if (!tick1Status.didJustFinish || !tick1.isLoaded) return;
    logRoundDiagnostic('rewinding completed countdown player', { name: 'final-tick-a' });
    void tick1.seekTo(0);
  }, [tick1, tick1Status.didJustFinish]);

  useEffect(() => {
    if (!tick2Status.didJustFinish || !tick2.isLoaded) return;
    logRoundDiagnostic('rewinding completed countdown player', { name: 'final-tick-b' });
    void tick2.seekTo(0);
  }, [tick2, tick2Status.didJustFinish]);

  const play = useCallback(
    (sound: RoundSoundId) => {
      logRoundDiagnostic('audio cue requested from provider', {
        sound,
        isReady,
        tickIndex: tickIndex.current,
      });
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
    [isReady, regularPlayers, tickPlayers],
  );

  const prepareForRound = useCallback(async () => {
    logRoundDiagnostic('round audio preparation requested', { isReady });
    if (!isReady) {
      warnRoundDiagnostic('round audio preparation blocked', new Error('Players are not loaded'), {
        pendingPlayers: getLoadSnapshot().pendingPlayers,
      });
      return false;
    }
    try {
      await setIsAudioActiveAsync(true);
      logRoundDiagnostic('audio session activated for round');
      tickIndex.current = 0;
      const players = [...Object.values(regularPlayers), ...tickPlayers];
      const results = await Promise.all(players.map(rewindRoundSoundPlayer));
      const prepared = results.every(Boolean);
      logRoundDiagnostic('round audio preparation completed', { prepared, rewindResults: results });
      return prepared;
    } catch (error) {
      warnRoundDiagnostic('round audio preparation failed', error);
      return false;
    }
  }, [getLoadSnapshot, isReady, regularPlayers, tickPlayers]);

  const retryLoading = useCallback(() => {
    logRoundDiagnostic('manual audio loading retry requested');
    setLoadTimedOut(false);
    for (const [sound, player] of Object.entries(regularPlayers) as [
      Exclude<RoundSoundId, 'final-tick'>,
      AudioPlayer,
    ][]) {
      if (!player.isLoaded) {
        logRoundDiagnostic('replacing unloaded audio source', { sound });
        player.replace(getRoundSoundSource(sound));
      }
    }
    for (const [index, player] of tickPlayers.entries()) {
      if (!player.isLoaded) {
        logRoundDiagnostic('replacing unloaded countdown source', { index });
        player.replace(getRoundSoundSource('final-tick'));
      }
    }
  }, [regularPlayers, tickPlayers]);

  const value = useMemo(
    () => ({ isReady, loadTimedOut: effectiveLoadTimedOut, play, prepareForRound, retryLoading }),
    [effectiveLoadTimedOut, isReady, play, prepareForRound, retryLoading],
  );
  return <RoundSoundContext.Provider value={value}>{children}</RoundSoundContext.Provider>;
}

export function useRoundSounds() {
  const context = useContext(RoundSoundContext);
  if (!context) throw new Error('useRoundSounds must be used inside RoundSoundProvider');
  return context;
}
