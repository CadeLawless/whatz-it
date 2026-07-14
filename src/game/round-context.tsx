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
import {
  Camera,
  CameraView,
} from 'expo-camera';
import { Platform, StyleSheet } from 'react-native';

import { getDeckById } from '@/data/decks';
import { initialRoundState, roundReducer } from '@/game/game-reducer';
import type { CardOutcome, RoundState } from '@/game/game-types';
import { clampRoundDuration } from '@/game/round-duration';
import { shuffle } from '@/game/shuffle';
import { getSessionCardPool } from '@/game/session-card-memory';
import { storeRoundVideo, type RoundVideo } from '@/video/round-videos';

type RoundContextValue = {
  round: RoundState;
  configureRound: (deckId: string, durationSeconds: number) => boolean;
  startRound: () => void;
  answerCard: (outcome: CardOutcome) => void;
  advanceCard: () => void;
  finishRound: () => void;
  resetRound: () => void;
  currentVideo: RoundVideo | null;
  prepareRecording: () => Promise<boolean>;
  startRecording: () => boolean;
  stopRecording: () => Promise<RoundVideo | null>;
  cancelRecording: () => Promise<void>;
};

const RoundContext = createContext<RoundContextValue | null>(null);

export function RoundProvider({ children }: PropsWithChildren) {
  const [round, dispatch] = useReducer(roundReducer, initialRoundState);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [recordWithAudio, setRecordWithAudio] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<RoundVideo | null>(null);
  const seenCardsByDeck = useRef(new Map<string, Set<string>>());
  const cameraRef = useRef<CameraView>(null);
  const cameraReady = useRef(false);
  const cameraReadyResolver = useRef<((ready: boolean) => void) | null>(null);
  const recordingCancelled = useRef(false);
  const preparationPromise = useRef<Promise<boolean> | null>(null);
  const recordingPromise = useRef<ReturnType<CameraView['recordAsync']> | null>(null);
  const stoppingPromise = useRef<Promise<RoundVideo | null> | null>(null);

  const rememberCard = (deckId: string | null, cardId: string | undefined) => {
    if (!deckId || !cardId) return;
    const seenCards = seenCardsByDeck.current.get(deckId) ?? new Set<string>();
    seenCards.add(cardId);
    seenCardsByDeck.current.set(deckId, seenCards);
  };

  const prepareRecording = useCallback(() => {
    if (Platform.OS === 'web') return Promise.resolve(false);
    if (cameraReady.current && cameraRef.current) return Promise.resolve(true);
    if (preparationPromise.current) return preparationPromise.current;

    preparationPromise.current = (async () => {
      const cameraPermission = await Camera.requestCameraPermissionsAsync();
      if (!cameraPermission.granted || recordingCancelled.current) return false;
      const microphonePermission = await Camera.requestMicrophonePermissionsAsync();
      if (recordingCancelled.current) return false;
      setRecordWithAudio(microphonePermission.granted);
      setCameraEnabled(true);
      if (cameraReady.current) return true;
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          cameraReadyResolver.current = null;
          resolve(false);
        }, 5000);
        cameraReadyResolver.current = (ready) => {
          clearTimeout(timeout);
          resolve(ready);
        };
      });
    })().finally(() => {
      preparationPromise.current = null;
    });
    return preparationPromise.current;
  }, []);

  const startRecording = useCallback(() => {
    if (!cameraReady.current || !cameraRef.current || recordingPromise.current) return false;
    recordingPromise.current = cameraRef.current.recordAsync({
      maxDuration: round.durationSeconds + 30,
    });
    return true;
  }, [round.durationSeconds]);

  const stopRecording = useCallback(async () => {
    if (stoppingPromise.current) return stoppingPromise.current;
    if (!recordingPromise.current || !round.deckId) {
      cameraReady.current = false;
      setCameraEnabled(false);
      return currentVideo;
    }
    const pendingRecording = recordingPromise.current;
    const deckId = round.deckId;
    stoppingPromise.current = (async () => {
      cameraRef.current?.stopRecording();
      try {
        const result = await pendingRecording;
        if (!result?.uri) return null;
        const video = await storeRoundVideo(result.uri, deckId);
        setCurrentVideo(video);
        return video;
      } catch {
        return null;
      } finally {
        recordingPromise.current = null;
        stoppingPromise.current = null;
        cameraReady.current = false;
        setCameraEnabled(false);
      }
    })();
    return stoppingPromise.current;
  }, [currentVideo, round.deckId]);

  const cancelRecording = useCallback(async () => {
    recordingCancelled.current = true;
    const pendingRecording = recordingPromise.current;
    if (!pendingRecording) {
      cameraReady.current = false;
      setCameraEnabled(false);
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
      cameraReady.current = false;
      setCameraEnabled(false);
    }
  }, []);

  const value = useMemo<RoundContextValue>(
    () => ({
      round,
      currentVideo,
      prepareRecording,
      startRecording,
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
        rememberCard(round.deckId, round.cardOrder[round.currentCardIndex]);
        dispatch({ type: 'START', now: Date.now() });
      },
      answerCard: (outcome) => dispatch({ type: 'ANSWER', outcome, now: Date.now() }),
      advanceCard: () => {
        if (round.status === 'feedback') {
          rememberCard(round.deckId, round.cardOrder[round.currentCardIndex + 1]);
        }
        dispatch({ type: 'ADVANCE' });
      },
      finishRound: () => dispatch({ type: 'FINISH', now: Date.now() }),
      resetRound: () => dispatch({ type: 'RESET' }),
    }),
    [cancelRecording, currentVideo, prepareRecording, round, startRecording, stopRecording],
  );

  return (
    <RoundContext.Provider value={value}>
      {children}
      {cameraEnabled && (
        <CameraView
          facing="front"
          mirror
          mode="video"
          mute={!recordWithAudio}
          onCameraReady={() => {
            cameraReady.current = true;
            cameraReadyResolver.current?.(true);
            cameraReadyResolver.current = null;
          }}
          onMountError={() => {
            cameraReady.current = false;
            cameraReadyResolver.current?.(false);
            cameraReadyResolver.current = null;
          }}
          pointerEvents="none"
          ref={cameraRef}
          style={styles.hiddenCamera}
        />
      )}
    </RoundContext.Provider>
  );
}

export function useRound() {
  const context = useContext(RoundContext);
  if (!context) throw new Error('useRound must be used inside RoundProvider');
  return context;
}

const styles = StyleSheet.create({
  hiddenCamera: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 2,
    height: 2,
    opacity: 0.01,
  },
});
