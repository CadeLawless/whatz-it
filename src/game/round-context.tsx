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
  resolveRoundAudioCues,
  type RoundSoundId,
  type RoundVideoSoundCue,
} from '@/video/round-sounds';

export type RecordingPreparation = 'ready' | 'permission-denied' | 'unavailable' | 'error';

type RoundContextValue = {
  round: RoundState;
  configureRound: (deckId: string, durationSeconds: number) => boolean;
  startRound: () => void;
  answerCard: (outcome: CardOutcome) => void;
  advanceCard: () => void;
  finishRound: () => void;
  resetRound: () => void;
  currentVideo: RoundVideo | null;
  deleteCurrentVideo: () => Promise<void>;
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

  const prepareRecording = useCallback(() => {
    if (Platform.OS === 'web') return Promise.resolve<RecordingPreparation>('unavailable');
    if (cameraReady.current && cameraRef.current) {
      return Promise.resolve<RecordingPreparation>('ready');
    }
    if (preparationPromise.current) return preparationPromise.current;

    preparationPromise.current = (async () => {
      const permissionsGranted = await requestRoundCameraPermissions();
      if (recordingCancelled.current) return 'unavailable' as const;
      if (!permissionsGranted) return 'permission-denied' as const;

      setCameraEnabled(true);
      if (cameraReady.current) return 'ready' as const;
      const ready = await new Promise<boolean>((resolve) => {
        cameraReadyResolver.current = resolve;
      });
      return ready ? ('ready' as const) : ('error' as const);
    })()
      .catch(() => {
        cameraReady.current = false;
        setCameraEnabled(false);
        return 'error' as const;
      })
      .finally(() => {
        preparationPromise.current = null;
      });
    return preparationPromise.current;
  }, []);

  const startRecording = useCallback(async () => {
    if (!cameraReady.current || !cameraRef.current || recordingActive.current) return false;
    const startedAt = await cameraRef.current.startRecording(round.durationSeconds + 30);
    if (startedAt === null) return false;
    recordingEvents.current = [];
    recordingSoundCues.current = [];
    recordingStartedAt.current = startedAt;
    recordingActive.current = true;
    return true;
  }, [round.durationSeconds]);

  const finishCameraSession = useCallback(() => {
    cameraReady.current = false;
    recordingActive.current = false;
    recordingStartedAt.current = null;
    setCameraEnabled(false);
    setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: false,
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
    const soundCues = [...recordingSoundCues.current];
    stoppingPromise.current = (async () => {
      try {
        const capture = await cameraRef.current?.stopRecording();
        if (!capture) return null;

        let temporaryAudioUri = capture.microphoneUri;
        if (Platform.OS === 'ios' && capture.microphoneUri) {
          try {
            const { mixRoundAudio } = await import('whatz-it-video-export');
            temporaryAudioUri = await mixRoundAudio(
              capture.videoUri,
              capture.microphoneUri,
              capture.microphoneOffsetMs,
              await resolveRoundAudioCues(soundCues),
            );
          } catch {
            // Preserve the microphone recording if cue mixing is ever unavailable.
            temporaryAudioUri = capture.microphoneUri;
          }
        }

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
      } catch {
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

  const value = useMemo<RoundContextValue>(
    () => ({
      round,
      currentVideo,
      deleteCurrentVideo,
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
        if (card) recordOverlayEvent({ kind: 'card', text: card.text });
        dispatch({ type: 'START', now: Date.now() });
      },
      answerCard: (outcome) => {
        recordOverlayEvent({
          kind: outcome === 'correct' ? 'correct' : 'passed',
          text: outcome === 'correct' ? 'CORRECT!' : 'PASS',
        });
        dispatch({ type: 'ANSWER', outcome, now: Date.now() });
      },
      advanceCard: () => {
        if (round.status === 'feedback') {
          const nextCardId = round.cardOrder[round.currentCardIndex + 1];
          rememberCard(round.deckId, nextCardId);
          const deck = getDeckById(round.deckId ?? undefined);
          const card = deck?.cards.find((candidate) => candidate.id === nextCardId);
          if (card) recordOverlayEvent({ kind: 'card', text: card.text });
        }
        dispatch({ type: 'ADVANCE' });
      },
      finishRound: () => {
        recordOverlayEvent({ kind: 'times-up', text: "TIME'S UP!" });
        dispatch({ type: 'FINISH', now: Date.now() });
      },
      resetRound: () => dispatch({ type: 'RESET' }),
    }),
    [
      cancelRecording,
      currentVideo,
      deleteCurrentVideo,
      prepareRecording,
      recordOverlayEvent,
      recordSoundCue,
      round,
      startRecording,
      stopRecording,
    ],
  );

  return (
    <RoundContext.Provider value={value}>
      <RoundCamera
        enabled={cameraEnabled}
        onReady={() => {
            cameraReady.current = true;
            cameraReadyResolver.current?.(true);
            cameraReadyResolver.current = null;
        }}
        onError={() => {
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
