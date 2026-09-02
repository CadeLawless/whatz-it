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
import { AppState, Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { cancelRoundHaptics } from '@/utils/round-haptics';
import {
  getRoundSoundSource,
  playRoundSound,
  preloadCriticalRoundSounds,
  rewindRoundSoundPlayer,
  stopRoundSoundPlayer,
  type RoundSoundId,
} from '@/video/round-sounds';
import { logRoundDiagnostic, warnRoundDiagnostic } from '@/video/video-diagnostics';

const PLAYER_OPTIONS = Platform.select({
  // This is an iOS-only option. It deliberately remains on the platform that
  // supports it; it never kept Android players alive.
  ios: {
    downloadFirst: true,
    keepAudioSessionActive: true,
    updateInterval: 500,
  },
  // Android needs its own copy of each bundled cue before a recording starts.
  // Expo specifically recommends downloadFirst for multiple simultaneous
  // players, avoiding the CameraX-owned cache path that could unload a cue.
  default: {
    downloadFirst: true,
    updateInterval: 500,
  },
})!;
const AUDIO_LOAD_TIMEOUT_MS = 3_000;

type RoundSoundContextValue = {
  isReady: boolean;
  loadTimedOut: boolean;
  play: (sound: RoundSoundId, isCurrent?: () => boolean) => Promise<boolean>;
  prepareForRound: () => Promise<boolean>;
  stopAll: () => void;
  stopIntro: () => void;
  recoverAudio: (reloadAll?: boolean) => Promise<void>;
};

const RoundSoundContext = createContext<RoundSoundContextValue | null>(null);

export function RoundSoundProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const generation = useRef(0);
  const getReady = useAudioPlayer(getRoundSoundSource('get-ready'), PLAYER_OPTIONS);
  // Keep the three identical countdown cues on separate native players. Android
  // can race a seek/play replay on one completed player, causing the cues to
  // bunch together before the visual countdown instead of firing once per second.
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
  const criticalStatuses = useMemo(
    () => [
      ['get-ready', getReadyStatus],
      ['count-3', count3Status],
      ['count-2', count2Status],
      ['count-1', count1Status],
      ['round-start', roundStartStatus],
    ] as const,
    [count1Status, count2Status, count3Status, getReadyStatus, roundStartStatus],
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
    [correct, count1, count2, count3, flip, getReady, pass, roundEnd, roundStart],
  );
  const tickPlayers = useMemo(
    () => [tick1, tick2],
    [tick1, tick2],
  );
  const tickIndex = useRef(0);
  const previousStatusKeys = useRef(new Map<string, string>());
  const audioModePromise = useRef<Promise<boolean> | null>(null);
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
      ['count-3', 'count-3', count3, 'critical'],
      ['count-2', 'count-2', count2, 'critical'],
      ['count-1', 'count-1', count1, 'critical'],
      ['round-start', 'round-start', roundStart, 'critical'],
      ['correct', 'correct', correct, 'gameplay'],
      ['pass', 'pass', pass, 'gameplay'],
      ['flip', 'flip', flip, 'gameplay'],
      ['round-end', 'round-end', roundEnd, 'gameplay'],
      ['final-tick-a', 'final-tick', tick1, 'gameplay'],
      ['final-tick-b', 'final-tick', tick2, 'gameplay'],
    ],
    [correct, count1, count2, count3, flip, getReady, pass, roundEnd, roundStart, tick1, tick2],
  );
  const statusesRef = useRef(namedStatuses);
  useEffect(() => { statusesRef.current = namedStatuses; }, [namedStatuses]);
  const getLoadSnapshot = useCallback(() => {
    const failedPlayers: { name: string; error: string | null }[] = [];
    const loadedPlayers: string[] = [];
    const pendingPlayers: string[] = [];
    // Status events are already in JS. Direct getters synchronously wait on
    // Android's main thread and were adding dozens of round trips per update.
    for (const [name, status] of statusesRef.current) {
      if (status.error) failedPlayers.push({ name, error: status.error });
      else if (status.isLoaded) loadedPlayers.push(name);
      else pendingPlayers.push(name);
    }
    return { failedPlayers, loadedPlayers, pendingPlayers };
  }, []);

  const stopAll = useCallback(() => {
    generation.current += 1;
    cancelRoundHaptics();
    for (const [, , player] of playerEntries) stopRoundSoundPlayer(player);
  }, [playerEntries]);
  const stopIntro = useCallback(() => {
    generation.current += 1;
    cancelRoundHaptics();
    for (const sound of ['get-ready', 'count-3', 'count-2', 'count-1'] as const) {
      stopRoundSoundPlayer(regularPlayers[sound]);
    }
  }, [regularPlayers]);
  useEffect(() => {
    if (pathname !== '/ready' && pathname !== '/game') stopAll();
  }, [pathname, stopAll]);
  useEffect(() => () => stopAll(), [stopAll]);

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
      if (nextState !== 'active') {
        stopAll();
        return;
      }
      if (!enteredForeground) return;
      logRoundDiagnostic('audio provider entered foreground; restoring session');
      void configureAudioSession();
    });
    return () => subscription.remove();
  }, [configureAudioSession, stopAll]);

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
  }, [namedStatuses]);

  useEffect(() => {
    const snapshot = getLoadSnapshot();
    logRoundDiagnostic('audio readiness changed', {
      isReady,
      gameplayReady,
      ...snapshot,
    });
    if (isReady) {
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
    }, AUDIO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [
    gameplayReady,
    getLoadSnapshot,
    isReady,
    readinessSignature,
  ]);

  const play = useCallback(
    async (sound: RoundSoundId, isCurrent: () => boolean = () => true) => {
      if (AppState.currentState !== 'active' || !isCurrent()) return false;
      if (sound === 'round-end') stopAll();
      const requestGeneration = generation.current;
      const canPlay = () => generation.current === requestGeneration && isCurrent();
      // Do not await a native audio-session operation here. Android serializes
      // those operations, so 3-2-1 requests can accumulate behind a slow
      // activation and then all call play() together. The session is armed
      // during round preparation (and again after recording starts); cues
      // themselves must stay on the timer's timeline.
      if (sound !== 'final-tick') {
        return playRoundSound(regularPlayers[sound], sound, canPlay);
      }
      const player = tickPlayers[tickIndex.current % tickPlayers.length];
      tickIndex.current += 1;
      return playRoundSound(player, sound, canPlay);
    },
    [regularPlayers, stopAll, tickPlayers],
  );

  const prepareForRound = useCallback(async () => {
    const before = getLoadSnapshot();
    const requestGeneration = generation.current;
    logRoundDiagnostic('round audio preparation requested', before);
    try {
      const sessionReady = await configureAudioSession();
      if (requestGeneration !== generation.current) return false;
      tickIndex.current = 0;
      const results = await Promise.all(
        playerEntries.map(async ([name, sound, player]) => ({
          name,
          prepared: await rewindRoundSoundPlayer(player, sound),
        })),
      );
      const failedPlayers = results
        .filter((result) => !result.prepared)
        .map((result) => result.name);
      const prepared = requestGeneration === generation.current && sessionReady && failedPlayers.length === 0;
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
  }, [configureAudioSession, getLoadSnapshot, playerEntries]);

  const recoverAudio = useCallback(async () => {
    // Never replace a player after Android has released its shared object.
    // A fresh app/round mount owns player construction; recovery here only
    // restores the shared audio session.
    await configureAudioSession();
  }, [configureAudioSession]);

  const value = useMemo(
    () => ({ isReady, loadTimedOut: effectiveLoadTimedOut, play, prepareForRound, recoverAudio, stopAll, stopIntro }),
    [effectiveLoadTimedOut, isReady, play, prepareForRound, recoverAudio, stopAll, stopIntro],
  );
  return <RoundSoundContext.Provider value={value}>{children}</RoundSoundContext.Provider>;
}

export function useRoundSounds() {
  const context = useContext(RoundSoundContext);
  if (!context) throw new Error('useRoundSounds must be used inside RoundSoundProvider');
  return context;
}
