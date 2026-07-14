import { setAudioModeAsync } from 'expo-audio';
import { Camera, CameraView } from 'expo-camera';
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
import { Platform, StyleSheet } from 'react-native';

import { getDeckById } from '@/data/decks';
import { initialRoundState, roundReducer } from '@/game/game-reducer';
import type { CardOutcome, RoundState } from '@/game/game-types';
import { clampRoundDuration } from '@/game/round-duration';
import { shuffle } from '@/game/shuffle';
import { getSessionCardPool } from '@/game/session-card-memory';
import {
  storeRoundVideo,
  type RoundVideo,
  type RoundVideoEvent,
} from '@/video/round-videos';

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
  prepareRecording: () => Promise<RecordingPreparation>;
  startRecording: () => boolean;
  recordOverlayEvent: (event: Omit<RoundVideoEvent, 'atMs'>) => void;
  stopRecording: () => Promise<RoundVideo | null>;
  cancelRecording: () => Promise<void>;
};

const RoundContext = createContext<RoundContextValue | null>(null);

export function RoundProvider({ children }: PropsWithChildren) {
  const [round, dispatch] = useReducer(roundReducer, initialRoundState);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<RoundVideo | null>(null);
  const seenCardsByDeck = useRef(new Map<string, Set<string>>());
  const cameraRef = useRef<CameraView>(null);
  const cameraReady = useRef(false);
  const cameraReadyResolver = useRef<((ready: boolean) => void) | null>(null);
  const recordingCancelled = useRef(false);
  const preparationPromise = useRef<Promise<RecordingPreparation> | null>(null);
  const recordingPromise = useRef<ReturnType<CameraView['recordAsync']> | null>(null);
  const stoppingPromise = useRef<Promise<RoundVideo | null> | null>(null);
  const recordingStartedAt = useRef<number | null>(null);
  const recordingEvents = useRef<RoundVideoEvent[]>([]);

  const rememberCard = (deckId: string | null, cardId: string | undefined) => {
    if (!deckId || !cardId) return;
    const seenCards = seenCardsByDeck.current.get(deckId) ?? new Set<string>();
    seenCards.add(cardId);
    seenCardsByDeck.current.set(deckId, seenCards);
  };

  const recordOverlayEvent = useCallback((event: Omit<RoundVideoEvent, 'atMs'>) => {
    if (recordingStartedAt.current === null || !recordingPromise.current) return;
    const atMs = Math.max(0, Date.now() - recordingStartedAt.current);
    const previous = recordingEvents.current.at(-1);
    if (previous?.kind === event.kind && previous.text === event.text) return;
    recordingEvents.current.push({ ...event, atMs });
  }, []);

  const prepareRecording = useCallback(() => {
    if (Platform.OS === 'web') return Promise.resolve<RecordingPreparation>('unavailable');
    if (cameraReady.current && cameraRef.current) {
      return Promise.resolve<RecordingPreparation>('ready');
    }
    if (preparationPromise.current) return preparationPromise.current;

    preparationPromise.current = (async () => {
      const cameraPermission = await Camera.requestCameraPermissionsAsync();
      if (recordingCancelled.current) return 'unavailable' as const;
      if (!cameraPermission.granted) return 'permission-denied' as const;

      const microphonePermission = await Camera.requestMicrophonePermissionsAsync();
      if (recordingCancelled.current) return 'unavailable' as const;
      if (!microphonePermission.granted) return 'permission-denied' as const;

      await setAudioModeAsync({
        allowsRecording: true,
        interruptionMode: 'doNotMix',
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });

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

  const startRecording = useCallback(() => {
    if (!cameraReady.current || !cameraRef.current || recordingPromise.current) return false;
    recordingEvents.current = [];
    recordingStartedAt.current = Date.now();
    recordingPromise.current = cameraRef.current.recordAsync({
      maxDuration: round.durationSeconds + 30,
    });
    return true;
  }, [round.durationSeconds]);

  const finishCameraSession = useCallback(() => {
    cameraReady.current = false;
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
    if (!recordingPromise.current || !round.deckId) {
      finishCameraSession();
      return currentVideo;
    }
    const pendingRecording = recordingPromise.current;
    const deckId = round.deckId;
    const events = [...recordingEvents.current];
    stoppingPromise.current = (async () => {
      cameraRef.current?.stopRecording();
      try {
        const result = await pendingRecording;
        if (!result?.uri) return null;
        const video = await storeRoundVideo(result.uri, deckId, events);
        setCurrentVideo(video);
        return video;
      } catch {
        return null;
      } finally {
        recordingPromise.current = null;
        stoppingPromise.current = null;
        recordingEvents.current = [];
        finishCameraSession();
      }
    })();
    return stoppingPromise.current;
  }, [currentVideo, finishCameraSession, round.deckId]);

  const cancelRecording = useCallback(async () => {
    recordingCancelled.current = true;
    cameraReadyResolver.current?.(false);
    cameraReadyResolver.current = null;
    const pendingRecording = recordingPromise.current;
    if (!pendingRecording) {
      finishCameraSession();
      return;
    }
    cameraRef.current?.stopRecording();
    try {
      const result = await pendingRecording;
      if (result?.uri) {
        const { File } = await import('expo-file-system');
        const temporaryFile = new File(result.uri);
        if (temporaryFile.exists) temporaryFile.delete();
      }
    } catch {
      // Nothing needs cleaning up when the native recorder did not produce a file.
    } finally {
      recordingPromise.current = null;
      recordingEvents.current = [];
      finishCameraSession();
    }
  }, [finishCameraSession]);

  const value = useMemo<RoundContextValue>(
    () => ({
      round,
      currentVideo,
      prepareRecording,
      startRecording,
      recordOverlayEvent,
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
      prepareRecording,
      recordOverlayEvent,
      round,
      startRecording,
      stopRecording,
    ],
  );

  return (
    <RoundContext.Provider value={value}>
      {cameraEnabled && (
        <CameraView
          active
          facing="front"
          mirror
          mode="video"
          mute={false}
          onCameraReady={() => {
            cameraReady.current = true;
            cameraReadyResolver.current?.(true);
            cameraReadyResolver.current = null;
          }}
          onMountError={() => {
            cameraReady.current = false;
            setCameraEnabled(false);
            cameraReadyResolver.current?.(false);
            cameraReadyResolver.current = null;
          }}
          pointerEvents="none"
          ref={cameraRef}
          style={styles.cameraHost}
        />
      )}
      {children}
    </RoundContext.Provider>
  );
}

export function useRound() {
  const context = useContext(RoundContext);
  if (!context) throw new Error('useRound must be used inside RoundProvider');
  return context;
}

const styles = StyleSheet.create({
  cameraHost: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
