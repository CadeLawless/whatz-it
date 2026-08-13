export type ReadyIntroGateState = {
  appActive: boolean;
  audioStartupGraceComplete: boolean;
  introStarted: boolean;
  isLeaving: boolean;
  orientationSettled: boolean;
  positionReady: boolean;
  recordingPrepared: boolean;
};

/**
 * Audio readiness is deliberately absent from this gate. We allow a short,
 * bounded startup grace for native audio recovery, then gameplay can start
 * with haptics and visuals even when live sound is unavailable.
 */
export function canStartReadyIntro(state: ReadyIntroGateState): boolean {
  return (
    state.appActive &&
    state.audioStartupGraceComplete &&
    !state.introStarted &&
    !state.isLeaving &&
    state.orientationSettled &&
    state.positionReady &&
    state.recordingPrepared
  );
}
