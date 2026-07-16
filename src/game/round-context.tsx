import { setAudioModeAsync } from 'expo-audio';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { getDeckById } from '@/data/decks';
import { initialRoundState, roundReducer } from '@/game/game-reducer';
import type { CardOutcome, RoundState } from '@/game/game-types';
import { clampRoundDuration } from '@/game/round-duration';
import { shuffle } from '@/game/shuffle';
import { getSessionCardPool } from '@/game/session-card-memory';
import {
  requestRoundCameraPermissions,
  RoundCamera,
  type RoundCameraRef,
} from '@/video/round-camera';
import {
  deleteRoundVideo,
  prepareRoundVideoExport,
  storeRoundVideo,
  type RoundVideo,
  type RoundVideoEvent,
} from '@/video/round-videos';
import {
  type RoundSoundId,
  type RoundVideoSoundCue,
} from '@/video/round-sounds';
import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

export type RecordingPreparation = 'ready' | 'permission-denied' | 'unavailable' | 'error';

const CAMERA_CAPTURE_STOP_TIMEOUT_MS = 4_000;

type RoundContextValue = {
  round: RoundState;
  configureRound: (deckId: string, durationSeconds: number) => boolean;
  startRound: () => void;
  answerCard: (outcome: CardOutcome) => void;
  advanceCard: () => void;
  finishRound: () => void;
  resetRound: () => void;
  currentVideo: RoundVideo | null;
  isRecording: boolean;
  deleteCurrentVideo: () => Promise<void>;
  retryCurrentVideoExport: () => Promise<RoundVideo | null>;
  prepareRecording: () => Promise<RecordingPreparation>;
  startRecording: () => Promise<boolean>;
  recordOverlayEvent: (event: Omit<RoundVideoEvent, 'atMs'>) => void;
  recordSoundCue: (sound: RoundSoundId) => void;
  stopRecording: () => Promise<RoundVideo | null>;
  cancelRecording: () => Promise<void>;
};

const RoundContext = createContext<RoundContextValue | null>(null);

export function RoundProvider({ children }: PropsWithChildren) {
  const [round, dispatch] = useReducer(roundReducer, initialRoundState);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<RoundVideo | null>(null);
  const seenCardsByDeck = useRef(new Map<string, Set<string>>());
  const cameraRef = useRef<RoundCameraRef>(null);
  const cameraReady = useRef(false);
  const cameraReadyResolver = useRef<((ready: boolean) => void) | null>(null);
  const recordingCancelled = useRef(false);
  const preparationPromise = useRef<Promise<RecordingPreparation> | null>(null);
  const recordingActive = useRef(false);
  const stoppingPromise = useRef<Promise<RoundVideo | null> | null>(null);
  const recordingStartedAt = useRef<number | null>(null);
  const recordingEvents = useRef<RoundVideoEvent[]>([]);
  const recordingSoundCues = useRef<RoundVideoSoundCue[]>([]);

  const rememberCard = (deckId: string | null, cardId: string | undefined) => {
    if (!deckId || !cardId) return;
    const seenCards = seenCardsByDeck.current.get(deckId) ?? new Set<string>();
    seenCards.add(cardId);
    seenCardsByDeck.current.set(deckId, seenCards);
  };

  const recordOverlayEvent = useCallback((event: Omit<RoundVideoEvent, 'atMs'>) => {
    if (recordingStartedAt.current === null || !recordingActive.current) return;
    const atMs = Math.max(0, Date.now() - recordingStartedAt.current);
    const previous = recordingEvents.current.at(-1);
    if (previous?.kind === event.kind && previous.text === event.text) return;
    recordingEvents.current.push({ ...event, atMs });
  }, []);

  const recordSoundCue = useCallback((sound: RoundSoundId) => {
    if (recordingStartedAt.current === null || !recordingActive.current) return;
    recordingSoundCues.current.push({
      atMs: Math.max(0, Date.now() - recordingStartedAt.current),
      sound,
    });
  }, []);

  const getRecordingTimerEndsAtMs = useCallback((endsAt: number | null) => {
    if (endsAt === null || recordingStartedAt.current === null) return undefined;
    return Math.max(0, endsAt - recordingStartedAt.current);
  }, []);

  const prepareRecording = useCallback(() => {
    logVideoDiagnostic('recording preparation requested', {
      cameraReady: cameraReady.current,
      hasCameraRef: !!cameraRef.current,
      hasExistingPreparation: !!preparationPromise.current,
      platform: Platform.OS,
    });
    if (Platform.OS === 'web') {
      logVideoDiagnostic('recording preparation unavailable on web');
      return Promise.resolve<RecordingPreparation>('unavailable');
    }
    if (cameraReady.current && cameraRef.current) {
      logVideoDiagnostic('recording preparation reused ready camera');
      return Promise.resolve<RecordingPreparation>('ready');
    }
    if (preparationPromise.current) {
      logVideoDiagnostic('recording preparation joined existing request');
      return preparationPromise.current;
    }

    preparationPromise.current = (async () => {
      const permissions = await requestRoundCameraPermissions();
      logVideoDiagnostic('recording permissions returned to round context', permissions);
      if (recordingCancelled.current) {
        logVideoDiagnostic('recording preparation abandoned because round was cancelled');
        return 'unavailable' as const;
      }
      if (!permissions.cameraGranted) {
        logVideoDiagnostic('recording preparation stopped because camera permission was denied');
        return 'permission-denied' as const;
      }

      setMicrophoneEnabled(permissions.microphoneGranted);
      setCameraEnabled(true);
      logVideoDiagnostic('camera enabled; waiting for native started callback', {
        microphoneEnabled: permissions.microphoneGranted,
      });
      if (cameraReady.current) {
        logVideoDiagnostic('camera became ready before wait began');
        return 'ready' as const;
      }
      const ready = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          cameraReadyResolver.current = null;
          warnVideoDiagnostic(
            'camera readiness wait timed out',
            new Error('Camera did not report ready within 12 seconds'),
          );
          resolve(false);
        }, 12000);
        cameraReadyResolver.current = (value) => {
          clearTimeout(timeout);
          logVideoDiagnostic('camera readiness resolver completed', { value });
          resolve(value);
        };
      });
      // Keep a slow camera mounted so its eventual onStarted event can make Retry work.
      logVideoDiagnostic('recording preparation completed camera wait', { ready });
      return ready ? ('ready' as const) : ('error' as const);
    })()
      .catch((error) => {
        warnVideoDiagnostic('recording preparation failed', error);
        cameraReady.current = false;
        setCameraEnabled(false);
        return 'error' as const;
      })
      .finally(() => {
        logVideoDiagnostic('recording preparation request settled');
        preparationPromise.current = null;
      });
    return preparationPromise.current;
  }, []);

  const startRecording = useCallback(async () => {
    logVideoDiagnostic('round recording start requested from context', {
      cameraReady: cameraReady.current,
      hasCameraRef: !!cameraRef.current,
      recordingActive: recordingActive.current,
      roundDurationSeconds: round.durationSeconds,
    });
    if (!cameraReady.current || !cameraRef.current || recordingActive.current) {
      warnVideoDiagnostic('round recording start rejected by context guard', new Error('Recording prerequisites failed'), {
        cameraReady: cameraReady.current,
        hasCameraRef: !!cameraRef.current,
        recordingActive: recordingActive.current,
      });
      return false;
    }
    const startedAt = await cameraRef.current.startRecording(round.durationSeconds + 30);
    if (startedAt === null) {
      warnVideoDiagnostic('native round recording returned no start time', new Error('Recording failed to start'));
      return false;
    }
    recordingEvents.current = [];
    recordingSoundCues.current = [];
    recordingStartedAt.current = startedAt;
    recordingActive.current = true;
    setIsRecording(true);
    logVideoDiagnostic('round recording marked active in context', { startedAt });
    return true;
  }, [round.durationSeconds]);

  const finishCameraSession = useCallback(() => {
    cameraReady.current = false;
    recordingActive.current = false;
    setIsRecording(false);
    recordingStartedAt.current = null;
    setCameraEnabled(false);
    setMicrophoneEnabled(false);
    setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, []);

  const stopRecording = useCallback(async () => {
    if (stoppingPromise.current) return stoppingPromise.current;
    if (!recordingActive.current || !round.deckId) {
      finishCameraSession();
      return currentVideo;
    }
    const deckId = round.deckId;
    const events = [...recordingEvents.current];
    stoppingPromise.current = (async () => {
      try {
        const capture = await withTimeout(
          cameraRef.current?.stopRecording() ?? Promise.resolve(null),
          CAMERA_CAPTURE_STOP_TIMEOUT_MS,
          'Camera recording did not stop in time.',
        );
        if (!capture) return null;

        logVideoDiagnostic('round capture received', {
          eventCount: events.length,
          microphoneOffsetMs: capture.microphoneOffsetMs,
          microphoneUri: capture.microphoneUri,
          videoUri: capture.videoUri,
        });

        // The microphone naturally captures the audible round cues. Mixing the cue
        // files in again makes every game sound play twice.
        const temporaryAudioUri = capture.microphoneUri;

        const video = await storeRoundVideo(capture.videoUri, temporaryAudioUri, deckId, events);
        setCurrentVideo(video);
        void prepareRoundVideoExport(video).then((preparedVideo) => {
          setCurrentVideo((activeVideo) =>
            activeVideo?.id === preparedVideo.id ? preparedVideo : activeVideo,
          );
        });
        await cleanupTemporaryFiles([
          capture.videoUri,
          capture.microphoneUri,
          temporaryAudioUri,
        ]);
        return video;
      } catch (error) {
        warnVideoDiagnostic('round video storage failed', error);
        return null;
      } finally {
        stoppingPromise.current = null;
        recordingEvents.current = [];
        recordingSoundCues.current = [];
        finishCameraSession();
      }
    })();
    return stoppingPromise.current;
  }, [currentVideo, finishCameraSession, round.deckId]);

  const cancelRecording = useCallback(async () => {
    recordingCancelled.current = true;
    cameraReadyResolver.current?.(false);
    cameraReadyResolver.current = null;
    if (!recordingActive.current) {
      finishCameraSession();
      return;
    }
    try {
      await cameraRef.current?.cancelRecording();
    } catch {
      // Nothing needs cleaning up when the native recorder did not produce a file.
    } finally {
      recordingEvents.current = [];
      recordingSoundCues.current = [];
      finishCameraSession();
    }
  }, [finishCameraSession]);

  const deleteCurrentVideo = useCallback(async () => {
    const video = currentVideo;
    if (!video) return;
    await deleteRoundVideo(video.id);
    setCurrentVideo((activeVideo) => (activeVideo?.id === video.id ? null : activeVideo));
  }, [currentVideo]);

  const retryCurrentVideoExport = useCallback(async () => {
    const video = currentVideo;
    if (!video) return null;
    setCurrentVideo((activeVideo) =>
      activeVideo?.id === video.id
        ? { ...activeVideo, exportStatus: 'preparing' }
        : activeVideo,
    );
    const preparedVideo = await prepareRoundVideoExport(video);
    setCurrentVideo((activeVideo) =>
      activeVideo?.id === preparedVideo.id ? preparedVideo : activeVideo,
    );
    return preparedVideo;
  }, [currentVideo]);

  const value = useMemo<RoundContextValue>(
    () => ({
      round,
      currentVideo,
      isRecording,
      deleteCurrentVideo,
      retryCurrentVideoExport,
      prepareRecording,
      startRecording,
      recordOverlayEvent,
      recordSoundCue,
      stopRecording,
      cancelRecording,
      configureRound: (deckId, durationSeconds) => {
        const deck = getDeckById(deckId);
        if (!deck) return false;
        const seenCards = seenCardsByDeck.current.get(deckId) ?? new Set<string>();
        const pool = getSessionCardPool(
          deck.cards.map((card) => card.id),
          seenCards,
        );
        if (pool.resetMemory) seenCards.clear();
        seenCardsByDeck.current.set(deckId, seenCards);
        recordingCancelled.current = false;
        recordingEvents.current = [];
        recordingSoundCues.current = [];
        recordingStartedAt.current = null;
        setIsRecording(false);
        setCurrentVideo(null);
        dispatch({
          type: 'CONFIGURE',
          deckId,
          durationSeconds: clampRoundDuration(durationSeconds),
          cardOrder: shuffle(pool.cardIds),
        });
        return true;
      },
      startRound: () => {
        const cardId = round.cardOrder[round.currentCardIndex];
        rememberCard(round.deckId, cardId);
        const deck = getDeckById(round.deckId ?? undefined);
        const card = deck?.cards.find((candidate) => candidate.id === cardId);
        if (card) {
          recordOverlayEvent({
            kind: 'card',
            text: card.text,
            timerEndsAtMs: getRecordingTimerEndsAtMs(
              Date.now() + round.durationSeconds * 1000,
            ),
          });
        }
        dispatch({ type: 'START', now: Date.now() });
      },
      answerCard: (outcome) => {
        recordOverlayEvent({
          kind: outcome === 'correct' ? 'correct' : 'passed',
          text: outcome === 'correct' ? 'CORRECT!' : 'PASS',
          timerEndsAtMs: getRecordingTimerEndsAtMs(round.endsAt),
        });
        dispatch({ type: 'ANSWER', outcome, now: Date.now() });
      },
      advanceCard: () => {
        if (round.status === 'feedback') {
          const nextCardId = round.cardOrder[round.currentCardIndex + 1];
          rememberCard(round.deckId, nextCardId);
          const deck = getDeckById(round.deckId ?? undefined);
          const card = deck?.cards.find((candidate) => candidate.id === nextCardId);
          if (card) {
            recordOverlayEvent({
              kind: 'card',
              text: card.text,
              timerEndsAtMs: getRecordingTimerEndsAtMs(round.endsAt),
            });
          }
        }
        dispatch({ type: 'ADVANCE' });
      },
      finishRound: () => {
        recordOverlayEvent({ kind: 'times-up', text: "TIME'S UP!" });
        dispatch({ type: 'FINISH', now: Date.now() });
      },
      resetRound: () => {
        setIsRecording(false);
        dispatch({ type: 'RESET' });
      },
    }),
    [
      cancelRecording,
      currentVideo,
      deleteCurrentVideo,
      getRecordingTimerEndsAtMs,
      isRecording,
      prepareRecording,
      recordOverlayEvent,
      recordSoundCue,
      retryCurrentVideoExport,
      round,
      startRecording,
      stopRecording,
    ],
  );

  return (
    <RoundContext.Provider value={value}>
      <RoundCamera
        enabled={cameraEnabled}
        microphoneEnabled={microphoneEnabled}
        onReady={() => {
            cameraReady.current = true;
            cameraReadyResolver.current?.(true);
            cameraReadyResolver.current = null;
        }}
        onError={(error) => {
            warnVideoDiagnostic('camera session failed', error);
            cameraReady.current = false;
            setCameraEnabled(false);
            cameraReadyResolver.current?.(false);
            cameraReadyResolver.current = null;
        }}
        ref={cameraRef}
      />
      {children}
    </RoundContext.Provider>
  );
}

export function useRound() {
  const context = useContext(RoundContext);
  if (!context) throw new Error('useRound must be used inside RoundProvider');
  return context;
}

async function cleanupTemporaryFiles(uris: (string | undefined)[]) {
  const { File } = await import('expo-file-system');
  for (const uri of new Set(uris.filter((candidate): candidate is string => !!candidate))) {
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {
      // The persisted copy is already safe; temporary cleanup must not discard the result.
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
