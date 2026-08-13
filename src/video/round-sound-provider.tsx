import {
  type AudioPlayer,
  setAudioModeAsync,
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
import { AppState } from 'react-native';
import {
  getRoundSoundSource,
  playRoundSound,
  preloadCriticalRoundSounds,
  rewindRoundSoundPlayer,
  type RoundSoundId,
} from '@/video/round-sounds';
import { logRoundDiagnostic, warnRoundDiagnostic } from '@/video/video-diagnostics';

const PLAYER_OPTIONS = {
  keepAudioSessionActive: true,
  updateInterval: 250,
} as const;
const AUDIO_LOAD_TIMEOUT_MS = 3_000;
const AUDIO_RECOVERY_LOAD_WAIT_MS = 750;

type RoundSoundContextValue = {
  isReady: boolean;
  loadTimedOut: boolean;
  play: (sound: RoundSoundId) => Promise<boolean>;
  prepareForRound: () => Promise<boolean>;
  recoverAudio: (reloadAll?: boolean) => Promise<void>;
};

const RoundSoundContext = createContext<RoundSoundContextValue | null>(null);

export function RoundSoundProvider({ children }: PropsWithChildren) {
  const getReady = useAudioPlayer(getRoundSoundSource('get-ready'), PLAYER_OPTIONS);
  const countdown = useAudioPlayer(getRoundSoundSource('count-3'), PLAYER_OPTIONS);
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
  const countdownStatus = useAudioPlayerStatus(countdown);
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
      ['countdown', countdownStatus],
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
      countdownStatus,
      flipStatus,
      getReadyStatus,
      passStatus,
      roundEndStatus,
      roundStartStatus,
      tick1Status,
      tick2Status,
    ],
  );
  const criticalStatuses = useMemo(
    () => [
      ['get-ready', getReadyStatus],
      ['countdown', countdownStatus],
      ['round-start', roundStartStatus],
    ] as const,
    [countdownStatus, getReadyStatus, roundStartStatus],
  );

  const regularPlayers = useMemo<Record<Exclude<RoundSoundId, 'final-tick'>, AudioPlayer>>(
    () => ({
      'get-ready': getReady,
      'count-3': countdown,
      'count-2': countdown,
      'count-1': countdown,
      'round-start': roundStart,
      correct,
      pass,
      flip,
      'round-end': roundEnd,
    }),
    [correct, countdown, flip, getReady, pass, roundEnd, roundStart],
  );
  const tickPlayers = useMemo(
    () => [tick1, tick2],
    [tick1, tick2],
  );
  const tickIndex = useRef(0);
  const previousStatusKeys = useRef(new Map<string, string>());
  const audioModePromise = useRef<Promise<boolean> | null>(null);
  const automaticRecoveryAttempted = useRef(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const isReady = criticalStatuses.every(([, status]) => status.isLoaded && !status.error);
  const gameplayReady = namedStatuses
    .slice(3)
    .every(([, status]) => status.isLoaded && !status.error);
  const effectiveLoadTimedOut = loadTimedOut && !isReady;
  const readinessSignature = criticalStatuses
    .map(([name, status]) => `${name}:${status.isLoaded}:${status.error ?? ''}`)
    .join('|');
  const playerEntries = useMemo<[string, RoundSoundId, AudioPlayer, 'critical' | 'gameplay'][]>(
    () => [
      ['get-ready', 'get-ready', getReady, 'critical'],
      ['countdown', 'count-3', countdown, 'critical'],
      ['round-start', 'round-start', roundStart, 'critical'],
      ['correct', 'correct', correct, 'gameplay'],
      ['pass', 'pass', pass, 'gameplay'],
      ['flip', 'flip', flip, 'gameplay'],
      ['round-end', 'round-end', roundEnd, 'gameplay'],
      ['final-tick-a', 'final-tick', tick1, 'gameplay'],
      ['final-tick-b', 'final-tick', tick2, 'gameplay'],
    ],
    [correct, countdown, flip, getReady, pass, roundEnd, roundStart, tick1, tick2],
  );
  const getLoadSnapshot = useCallback(() => {
    const players = playerEntries.map(([name, , player]) => [name, player] as const);
    return {
      failedPlayers: players
        .filter(([, player]) => player.currentStatus.error)
        .map(([name, player]) => ({ name, error: player.currentStatus.error })),
      loadedPlayers: players.filter(([, player]) => player.isLoaded).map(([name]) => name),
      pendingPlayers: players.filter(([, player]) => !player.isLoaded).map(([name]) => name),
    };
  }, [playerEntries]);

  const configureAudioSession = useCallback(async () => {
    if (!audioModePromise.current) {
      audioModePromise.current = setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      })
        .then(() => true)
        .catch((error) => {
          warnRoundDiagnostic('initial audio mode configuration failed', error);
          audioModePromise.current = null;
          return false;
        });
    }
    const modeReady = await audioModePromise.current;
    if (!modeReady) return false;
    try {
      // Camera preparation may change the shared mode to play-and-record.
      // Reactivate that current mode for every cue without overwriting it.
      await setIsAudioActiveAsync(true);
      logRoundDiagnostic('current audio session activated');
      return true;
    } catch (error) {
      warnRoundDiagnostic('audio session activation failed', error);
      return false;
    }
  }, []);

  const reloadPlayers = useCallback((reloadAll = false) => {
    const reloaded: string[] = [];
    for (const [name, sound, player] of playerEntries) {
      if (reloadAll || !player.isLoaded || player.currentStatus.error) {
        player.replace(getRoundSoundSource(sound));
        reloaded.push(name);
      }
    }
    logRoundDiagnostic('audio players reloaded', { reloadAll, reloaded });
  }, [playerEntries]);

  useEffect(() => {
    logRoundDiagnostic('audio provider mounted', {
      playerCount: namedStatuses.length,
      loadTimeoutMs: AUDIO_LOAD_TIMEOUT_MS,
    });
    return () => logRoundDiagnostic('audio provider unmounted');
  }, [namedStatuses.length]);

  useEffect(() => {
    void configureAudioSession();
    void preloadCriticalRoundSounds();
  }, [configureAudioSession]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const enteredForeground = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (!enteredForeground) return;
      logRoundDiagnostic('audio provider entered foreground; restoring session');
      void configureAudioSession();
      reloadPlayers();
    });
    return () => subscription.remove();
  }, [configureAudioSession, reloadPlayers]);

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
      gameplayReady,
      ...snapshot,
    });
    if (isReady) {
      automaticRecoveryAttempted.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      setLoadTimedOut(true);
      const snapshot = getLoadSnapshot();
      warnRoundDiagnostic(
        'audio loading timed out; gameplay remains available',
        new Error('Not all audio players loaded'),
        snapshot,
      );
      if (!automaticRecoveryAttempted.current) {
        automaticRecoveryAttempted.current = true;
        reloadPlayers();
        void configureAudioSession();
      }
    }, AUDIO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [
    configureAudioSession,
    gameplayReady,
    getLoadSnapshot,
    isReady,
    readinessSignature,
    reloadPlayers,
  ]);

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
    async (sound: RoundSoundId) => {
      logRoundDiagnostic('audio cue requested from provider', {
        sound,
        isReady,
        tickIndex: tickIndex.current,
      });
      const sessionReady = await configureAudioSession();
      if (!sessionReady) return false;
      if (sound !== 'final-tick') {
        if (sound === 'round-end') {
          // The tick file is 1.129 seconds long. Stop the final tail at the
          // round boundary so it cannot overlap the Time's Up sound.
          for (const player of tickPlayers) {
            if (player.playing) player.pause();
          }
        }
        const player = regularPlayers[sound];
        if (!player.isLoaded || player.currentStatus.error) {
          warnRoundDiagnostic(
            'audio cue unavailable; reloading for a later cue',
            player.currentStatus.error,
            { sound },
          );
          player.replace(getRoundSoundSource(sound));
          return false;
        }
        return playRoundSound(player, sound);
      }
      const player = tickPlayers[tickIndex.current % tickPlayers.length];
      tickIndex.current += 1;
      if (!player.isLoaded || player.currentStatus.error) {
        warnRoundDiagnostic(
          'countdown audio cue unavailable; reloading for a later cue',
          player.currentStatus.error,
          { sound },
        );
        player.replace(getRoundSoundSource('final-tick'));
        return false;
      }
      return playRoundSound(player, sound);
    },
    [configureAudioSession, isReady, regularPlayers, tickPlayers],
  );

  const prepareForRound = useCallback(async () => {
    const before = getLoadSnapshot();
    logRoundDiagnostic('round audio preparation requested', { isReady, ...before });
    try {
      const sessionReady = await configureAudioSession();
      tickIndex.current = 0;
      const players: [string, AudioPlayer][] = [
        ['get-ready', getReady],
        ['countdown', countdown],
        ['round-start', roundStart],
      ];
      const results = await Promise.all(
        players.map(async ([name, player]) => ({
          name,
          prepared: await rewindRoundSoundPlayer(player),
        })),
      );
      const failedPlayers = results
        .filter((result) => !result.prepared)
        .map((result) => result.name);
      const prepared = sessionReady && failedPlayers.length === 0;
      logRoundDiagnostic('round audio preparation completed', {
        prepared,
        sessionReady,
        failedPlayers,
      });
      return prepared;
    } catch (error) {
      warnRoundDiagnostic('round audio preparation failed', error);
      return false;
    }
  }, [configureAudioSession, countdown, getLoadSnapshot, getReady, isReady, roundStart]);

  const recoverAudio = useCallback(async (reloadAll = false) => {
    logRoundDiagnostic('audio recovery requested', { reloadAll });
    setLoadTimedOut(false);
    reloadPlayers(reloadAll);
    const players = playerEntries.map(([, , player]) => player);
    await Promise.all([
      configureAudioSession(),
      waitForPlayersToLoad(players, AUDIO_RECOVERY_LOAD_WAIT_MS),
    ]);
  }, [configureAudioSession, playerEntries, reloadPlayers]);

  const value = useMemo(
    () => ({ isReady, loadTimedOut: effectiveLoadTimedOut, play, prepareForRound, recoverAudio }),
    [effectiveLoadTimedOut, isReady, play, prepareForRound, recoverAudio],
  );
  return <RoundSoundContext.Provider value={value}>{children}</RoundSoundContext.Provider>;
}

async function waitForPlayersToLoad(players: AudioPlayer[], timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (players.every((player) => player.isLoaded && !player.currentStatus.error)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

export function useRoundSounds() {
  const context = useContext(RoundSoundContext);
  if (!context) throw new Error('useRoundSounds must be used inside RoundSoundProvider');
  return context;
}
