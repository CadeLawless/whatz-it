import { setAudioModeAsync } from 'expo-audio';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';

import { getDeckById } from '@/data/decks';
import { getDailyCardPool } from '@/game/daily-card-memory';
import { initialRoundState, roundReducer } from '@/game/game-reducer';
import type { CardOutcome, RoundState } from '@/game/game-types';
import { clampRoundDuration } from '@/game/round-duration';
import { shuffle } from '@/game/shuffle';
import {
  loadDailySeenCardIds,
  rememberDailyCard,
  resetDailySeenCardIds,
} from '@/storage/daily-card-memory';
import {
  requestRoundCameraPermissions,
  RoundCamera,
  type RoundCapture,
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
  ROUND_VIDEO_SOUND_VOLUME,
  stopRoundSoundsAfterRound,
  subscribeToRoundSoundPlayback,
  type RoundVideoSoundCue,
  waitForPendingRoundSoundResults,
} from '@/video/round-sounds';
import {
  createPendingRoundSoundCue,
  finalizeRoundSoundReceipts,
  type PendingRoundVideoSoundCue,
} from '@/video/round-sound-receipts';
import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

export type RecordingPreparation = 'ready' | 'permission-denied' | 'unavailable' | 'error';

const CAMERA_CAPTURE_STOP_TIMEOUT_MS = 4_000;

type RoundContextValue = {
  round: RoundState;
  configureRound: (deckId: string, durationSeconds: number) => Promise<boolean>;
  startRound: () => void;
  answerCard: (outcome: CardOutcome) => void;
  advanceCard: () => void;
  finishRound: () => void;
  pauseRound: () => void;
  resumeRound: () => void;
  resetRound: () => void;
  currentVideo: RoundVideo | null;
  isRecording: boolean;
  isVideoFinalizing: boolean;
  deleteCurrentVideo: () => Promise<void>;
  retryCurrentVideoExport: () => Promise<RoundVideo | null>;
  prepareRecording: () => Promise<RecordingPreparation>;
  startRecording: () => Promise<boolean>;
  recordOverlayEvent: (event: Omit<RoundVideoEvent, 'atMs'>) => void;
  stopRecording: () => Promise<RoundVideo | null>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<boolean>;
  cancelRecording: () => Promise<void>;
};

type CapturedRoundSegment = {
  capture: RoundCapture;
  durationMs: number;
  events: RoundVideoEvent[];
  soundCues: RoundVideoSoundCue[];
};

const RoundContext = createContext<RoundContextValue | null>(null);

export function RoundProvider({ children }: PropsWithChildren) {
  const [round, dispatch] = useReducer(roundReducer, initialRoundState);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isVideoFinalizing, setIsVideoFinalizing] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<RoundVideo | null>(null);
  const cameraRef = useRef<RoundCameraRef>(null);
  const cameraReady = useRef(false);
  const cameraReadyResolver = useRef<((ready: boolean) => void) | null>(null);
  const recordingCancelled = useRef(false);
  const preparationPromise = useRef<Promise<RecordingPreparation> | null>(null);
  const recordingActive = useRef(false);
  const stoppingPromise = useRef<Promise<RoundVideo | null> | null>(null);
  const segmentStoppingPromise = useRef<Promise<void> | null>(null);
  const recordingStartedAt = useRef<number | null>(null);
  const recordingEvents = useRef<RoundVideoEvent[]>([]);
  const recordingSoundCues = useRef<PendingRoundVideoSoundCue[]>([]);
  const recordingSegments = useRef<CapturedRoundSegment[]>([]);

  const rememberCard = useCallback((deckId: string | null, cardId: string | undefined) => {
    if (!deckId || !cardId) return;
    rememberDailyCard(deckId, cardId);
  }, []);

  const recordOverlayEvent = useCallback((event: Omit<RoundVideoEvent, 'atMs'>) => {
    if (recordingStartedAt.current === null || !recordingActive.current) return;
    const atMs = Math.max(0, Date.now() - recordingStartedAt.current);
    const previous = recordingEvents.current.at(-1);
    if (
      previous?.kind === event.kind &&
      previous.text === event.text &&
      previous.byline === event.byline
    ) return;
    recordingEvents.current.push({ ...event, atMs });
  }, []);

  useEffect(
    () =>
      subscribeToRoundSoundPlayback((event) => {
        if (event.phase === 'requested') {
          const startedAt = recordingStartedAt.current;
          if (startedAt === null || !recordingActive.current) {
            logVideoDiagnostic('round cue request occurred outside active recording', {
              requestId: event.requestId,
              sound: event.sound,
            });
            return;
          }
          const cue = createPendingRoundSoundCue(
            event.requestId,
            event.sound,
            event.requestedAt,
            startedAt,
          );
          recordingSoundCues.current.push(cue);
          logVideoDiagnostic('round cue request attached to recording segment', cue);
          return;
        }

        const cue = recordingSoundCues.current.find(
          (candidate) => candidate.requestId === event.requestId,
        );
        if (!cue) {
          logVideoDiagnostic('round cue result had no active recording request', {
            requestId: event.requestId,
            sound: event.sound,
            wasAudible: event.wasAudible,
          });
          return;
        }
        cue.wasAudible = event.wasAudible;
        logVideoDiagnostic('round cue recording decision resolved', {
          atMs: cue.atMs,
          requestId: cue.requestId,
          sound: cue.sound,
          wasAudible: cue.wasAudible,
        });
      }),
    [],
  );

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

  const startRecordingSegment = useCallback(async () => {
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

  const startRecording = useCallback(async () => {
    recordingSegments.current = [];
    return startRecordingSegment();
  }, [startRecordingSegment]);

  const suspendCameraSession = useCallback(() => {
    cameraReady.current = false;
    recordingActive.current = false;
    recordingStartedAt.current = null;
    setIsRecording(false);
    setCameraEnabled(false);
    setMicrophoneEnabled(false);
  }, []);

  const captureActiveSegment = useCallback(async () => {
    const startedAt = recordingStartedAt.current;
    if (!recordingActive.current || startedAt === null) return null;
    recordingActive.current = false;
    setIsRecording(false);
    const soundResultsSettled = await waitForPendingRoundSoundResults();
    const events = [...recordingEvents.current];
    const pendingSoundCues = [...recordingSoundCues.current];
    const soundReceiptSummary = finalizeRoundSoundReceipts(pendingSoundCues);
    const soundCues = soundReceiptSummary.audibleCues;
    recordingStartedAt.current = null;
    logVideoDiagnostic('recording segment cue decisions finalized', {
      audibleCueCount: soundCues.length,
      ...soundReceiptSummary,
      soundResultsSettled,
    });
    const stoppedAt = Date.now();
    const capture = await withTimeout(
      cameraRef.current?.stopRecording() ?? Promise.resolve(null),
      CAMERA_CAPTURE_STOP_TIMEOUT_MS,
      'Camera recording did not stop in time.',
    );
    recordingEvents.current = [];
    recordingSoundCues.current = [];
    if (!capture) return null;
    const segment: CapturedRoundSegment = {
      capture,
      durationMs: Math.max(1, stoppedAt - startedAt),
      events,
      soundCues,
    };
    recordingSegments.current.push(segment);
    logVideoDiagnostic('round recording segment captured', {
      durationMs: segment.durationMs,
      eventCount: events.length,
      segmentCount: recordingSegments.current.length,
      soundCueCount: soundCues.length,
    });
    return segment;
  }, []);

  const pauseRecording = useCallback(async () => {
    if (segmentStoppingPromise.current) return segmentStoppingPromise.current;
    if (!recordingActive.current) {
      suspendCameraSession();
      return;
    }
    segmentStoppingPromise.current = captureActiveSegment()
      .catch((error) => {
        warnVideoDiagnostic('round recording segment pause failed', error);
        return null;
      })
      .then(() => undefined)
      .finally(() => {
        segmentStoppingPromise.current = null;
        suspendCameraSession();
      });
    return segmentStoppingPromise.current;
  }, [captureActiveSegment, suspendCameraSession]);

  const resumeRecording = useCallback(async () => {
    if (segmentStoppingPromise.current) await segmentStoppingPromise.current;
    if (
      recordingCancelled.current ||
      round.status === 'idle'
    ) return false;
    const preparation = await prepareRecording();
    if (preparation !== 'ready') return false;
    const started = await startRecordingSegment();
    if (!started) return false;
    if (round.status === 'ready') return true;
    if (round.status === 'finished') {
      recordOverlayEvent({ kind: 'times-up', text: "TIME'S UP!" });
      return true;
    }

    const activeStatus = round.status === 'paused' ? round.pausedStatus : round.status;
    const cardId =
      activeStatus === 'feedback'
        ? round.cardOrder[round.currentCardIndex + 1]
        : round.cardOrder[round.currentCardIndex];
    const deck = getDeckById(round.deckId ?? undefined);
    const card = deck?.cards.find((candidate) => candidate.id === cardId);
    const resumedEndsAt = round.status === 'paused'
      ? Date.now() + Math.max(0, round.remainingMs ?? 0)
      : round.endsAt;
    if (card) {
      recordOverlayEvent({
        kind: 'card',
        text: card.text,
        byline: card.byline,
        timerEndsAtMs: getRecordingTimerEndsAtMs(resumedEndsAt),
      });
    }
    return true;
  }, [
    getRecordingTimerEndsAtMs,
    prepareRecording,
    recordOverlayEvent,
    round,
    startRecordingSegment,
  ]);

  const finishCameraSession = useCallback(() => {
    cameraReady.current = false;
    recordingActive.current = false;
    setIsRecording(false);
    recordingStartedAt.current = null;
    recordingSegments.current = [];
    setCameraEnabled(false);
    setMicrophoneEnabled(false);
    stopRoundSoundsAfterRound();
    logVideoDiagnostic('resetting global audio mode after native recording session');
    setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    })
      .then(() => logVideoDiagnostic('global audio mode reset after native recording session'))
      .catch((error) => warnVideoDiagnostic('global audio mode reset failed', error));
  }, []);

  const stopRecording = useCallback(async () => {
    if (stoppingPromise.current) return stoppingPromise.current;
    if (!recordingActive.current && recordingSegments.current.length === 0) {
      setIsVideoFinalizing(false);
      finishCameraSession();
      return currentVideo;
    }
    if (!round.deckId) {
      setIsVideoFinalizing(false);
      finishCameraSession();
      return null;
    }
    const deckId = round.deckId;
    setIsVideoFinalizing(true);
    stoppingPromise.current = (async () => {
      const temporaryUris: (string | undefined)[] = [];
      try {
        if (segmentStoppingPromise.current) await segmentStoppingPromise.current;
        if (recordingActive.current) await captureActiveSegment();
        const segments = [...recordingSegments.current];
        if (segments.length === 0) return null;

        segments.forEach(({ capture }) => {
          temporaryUris.push(capture.videoUri, capture.microphoneUri);
        });
        const audioMixer =
          Platform.OS === 'ios' && segments.some(({ capture }) => !!capture.microphoneUri)
            ? await import('whatz-it-video-export')
            : null;
        const preparedSegments = await Promise.all(
          segments.map(async ({ capture, soundCues }) => {
            let audioUri = capture.microphoneUri;
            if (audioMixer && capture.microphoneUri && audioMixer.supportsRoundAudioMix()) {
              try {
                audioUri = await audioMixer.mixRoundAudio(
                  capture.videoUri,
                  capture.microphoneUri,
                  capture.microphoneOffsetMs,
                  await resolveRoundAudioCues(soundCues),
                  ROUND_VIDEO_SOUND_VOLUME,
                );
                temporaryUris.push(audioUri);
                logVideoDiagnostic('recording segment voice and confirmed cues mixed', {
                  audibleCueCount: soundCues.length,
                  cueVolume: ROUND_VIDEO_SOUND_VOLUME,
                  mixedAudioUri: audioUri,
                });
              } catch (error) {
                warnVideoDiagnostic(
                  'voice/cue mix failed; preserving captured microphone',
                  error,
                  {
                    audibleCueCount: soundCues.length,
                    microphoneUri: capture.microphoneUri,
                  },
                );
                audioUri = capture.microphoneUri;
              }
            }
            return { videoUri: capture.videoUri, audioUri: audioUri ?? null };
          }),
        );

        let videoUri = preparedSegments[0].videoUri;
        let audioUri = preparedSegments[0].audioUri ?? undefined;
        if (preparedSegments.length > 1) {
          const { stitchRoundVideoSegments } = await import('whatz-it-video-export');
          videoUri = await stitchRoundVideoSegments(preparedSegments);
          temporaryUris.push(videoUri);
          // The stitched MP4 contains the selected audio track for every segment.
          audioUri = undefined;
          logVideoDiagnostic('round recording segments stitched', {
            segmentCount: preparedSegments.length,
            videoUri,
          });
        }

        let offsetMs = 0;
        const events = segments.flatMap((segment) => {
          const adjusted = segment.events.map((event) => ({
            ...event,
            atMs: event.atMs + offsetMs,
            timerEndsAtMs:
              event.timerEndsAtMs === undefined
                ? undefined
                : event.timerEndsAtMs + offsetMs,
          }));
          offsetMs += segment.durationMs;
          return adjusted;
        });

        const video = await storeRoundVideo(videoUri, audioUri, deckId, events);
        setCurrentVideo(video);
        setIsVideoFinalizing(false);
        void prepareRoundVideoExport(video).then((preparedVideo) => {
          setCurrentVideo((activeVideo) =>
            activeVideo?.id === preparedVideo.id ? preparedVideo : activeVideo,
          );
        });
        return video;
      } catch (error) {
        warnVideoDiagnostic('round video storage failed', error);
        setIsVideoFinalizing(false);
        return null;
      } finally {
        await cleanupTemporaryFiles(temporaryUris);
        stoppingPromise.current = null;
        recordingEvents.current = [];
        recordingSoundCues.current = [];
        setIsVideoFinalizing(false);
        finishCameraSession();
      }
    })();
    return stoppingPromise.current;
  }, [captureActiveSegment, currentVideo, finishCameraSession, round.deckId]);

  const cancelRecording = useCallback(async () => {
    recordingCancelled.current = true;
    cameraReadyResolver.current?.(false);
    cameraReadyResolver.current = null;
    try {
      if (recordingActive.current) await cameraRef.current?.cancelRecording();
    } catch {
      // Nothing needs cleaning up when the native recorder did not produce a file.
    } finally {
      await cleanupTemporaryFiles(
        recordingSegments.current.flatMap(({ capture }) => [
          capture.videoUri,
          capture.microphoneUri,
        ]),
      );
      recordingEvents.current = [];
      recordingSoundCues.current = [];
      setIsVideoFinalizing(false);
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
      isVideoFinalizing,
      deleteCurrentVideo,
      retryCurrentVideoExport,
      prepareRecording,
      startRecording,
      recordOverlayEvent,
      stopRecording,
      pauseRecording,
      resumeRecording,
      cancelRecording,
      configureRound: async (deckId, durationSeconds) => {
        if (stoppingPromise.current) await stoppingPromise.current;
        const deck = getDeckById(deckId);
        if (!deck) return false;
        const seenCards = await loadDailySeenCardIds(deckId);
        const pool = getDailyCardPool(
          deck.cards.map((card) => card.id),
          seenCards,
        );
        if (pool.cardIds.length === 0) return false;
        if (pool.resetMemory) await resetDailySeenCardIds(deckId);
        recordingCancelled.current = false;
        recordingEvents.current = [];
        recordingSoundCues.current = [];
        recordingSegments.current = [];
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
            byline: card.byline,
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
          let nextCardId = round.cardOrder[round.currentCardIndex + 1];
          const replenishedCardOrder = nextCardId
            ? undefined
            : replenishDeck(round.deckId);
          if (replenishedCardOrder?.length) {
            void resetDailySeenCardIds(round.deckId!);
            nextCardId = replenishedCardOrder[0];
          }
          rememberCard(round.deckId, nextCardId);
          const deck = getDeckById(round.deckId ?? undefined);
          const card = deck?.cards.find((candidate) => candidate.id === nextCardId);
          if (card) {
            recordOverlayEvent({
              kind: 'card',
              text: card.text,
              byline: card.byline,
              timerEndsAtMs: getRecordingTimerEndsAtMs(round.endsAt),
            });
          }
          dispatch({ type: 'ADVANCE', replenishedCardOrder });
          return;
        }
        dispatch({ type: 'ADVANCE' });
      },
      finishRound: () => {
        recordOverlayEvent({ kind: 'times-up', text: "TIME'S UP!" });
        dispatch({ type: 'FINISH', now: Date.now() });
      },
      pauseRound: () => {
        dispatch({ type: 'PAUSE', now: Date.now() });
      },
      resumeRound: () => {
        let replenishedCardOrder: string[] | undefined;
        if (round.status === 'paused' && round.pausedStatus === 'feedback') {
          let nextCardId = round.cardOrder[round.currentCardIndex + 1];
          replenishedCardOrder = nextCardId
            ? undefined
            : replenishDeck(round.deckId);
          if (replenishedCardOrder?.length) {
            void resetDailySeenCardIds(round.deckId!);
            nextCardId = replenishedCardOrder[0];
          }
          rememberCard(round.deckId, nextCardId);
        }
        dispatch({ type: 'RESUME', now: Date.now(), replenishedCardOrder });
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
      isVideoFinalizing,
      prepareRecording,
      pauseRecording,
      recordOverlayEvent,
      rememberCard,
      resumeRecording,
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

function replenishDeck(deckId: string | null) {
  const deck = getDeckById(deckId ?? undefined);
  return deck ? shuffle(deck.cards.map((card) => card.id)) : undefined;
}
