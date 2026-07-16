export type TiltAction = 'correct' | 'passed';

export type GravityVector = {
  x: number;
  y: number;
  z: number;
};

export type LandscapeOrientation = 90 | -90;

export type TiltDetectorConfig = {
  calibrationSamples: number;
  calibrationMovementTolerance: number;
  smoothingFactor: number;
  triggerAngle: number;
  confirmationSamples: number;
  neutralAngle: number;
  rearmSamples: number;
  baselineAdjustmentFactor: number;
};

export type TiltDetectorState = {
  baseline: number | null;
  rawAngle: number | null;
  unwrappedAngle: number | null;
  filteredAngle: number | null;
  calibrationTotal: number;
  calibrationCount: number;
  armed: boolean;
  candidateAction: TiltAction | null;
  candidateCount: number;
  neutralCount: number;
};

export type TiltDetectorResult = {
  state: TiltDetectorState;
  action: TiltAction | null;
  calibrated: boolean;
  delta: number;
  rearmed: boolean;
};

export const DEFAULT_TILT_CONFIG: TiltDetectorConfig = {
  calibrationSamples: 16,
  calibrationMovementTolerance: 0.08,
  smoothingFactor: 0.35,
  triggerAngle: 0.48,
  confirmationSamples: 2,
  neutralAngle: 0.24,
  rearmSamples: 2,
  baselineAdjustmentFactor: 0.015,
};

export function createTiltDetectorState(): TiltDetectorState {
  return {
    baseline: null,
    rawAngle: null,
    unwrappedAngle: null,
    filteredAngle: null,
    calibrationTotal: 0,
    calibrationCount: 0,
    armed: true,
    candidateAction: null,
    candidateCount: 0,
    neutralCount: 0,
  };
}

export function updateTiltDetector(
  state: TiltDetectorState,
  angle: number,
  config = DEFAULT_TILT_CONFIG,
  canTrigger = true,
): TiltDetectorResult {
  const unwrappedAngle = unwrapTiltAngle(angle, state.rawAngle, state.unwrappedAngle);
  const movement = state.unwrappedAngle === null ? 0 : Math.abs(unwrappedAngle - state.unwrappedAngle);
  const filteredAngle =
    state.filteredAngle === null
      ? unwrappedAngle
      : state.filteredAngle + config.smoothingFactor * (unwrappedAngle - state.filteredAngle);

  if (state.baseline === null) {
    const stable = movement <= config.calibrationMovementTolerance;
    const calibrationCount = stable ? state.calibrationCount + 1 : 1;
    const calibrationTotal = stable ? state.calibrationTotal + filteredAngle : filteredAngle;
    const calibrated = calibrationCount >= config.calibrationSamples;
    const baseline = calibrated ? calibrationTotal / calibrationCount : null;

    return {
      state: {
        ...state,
        baseline,
        rawAngle: angle,
        unwrappedAngle,
        filteredAngle,
        calibrationCount,
        calibrationTotal,
      },
      action: null,
      calibrated,
      delta: 0,
      rearmed: false,
    };
  }

  const delta = filteredAngle - state.baseline;

  if (!state.armed) {
    const neutralCount = Math.abs(delta) <= config.neutralAngle ? state.neutralCount + 1 : 0;
    const rearmed = neutralCount >= config.rearmSamples;
    return {
      state: {
        ...state,
        rawAngle: angle,
        unwrappedAngle,
        filteredAngle,
        armed: rearmed,
        candidateAction: null,
        candidateCount: 0,
        neutralCount,
      },
      action: null,
      calibrated: true,
      delta,
      rearmed,
    };
  }

  const candidateAction =
    delta >= config.triggerAngle ? 'correct' : delta <= -config.triggerAngle ? 'passed' : null;

  if (!canTrigger) {
    return {
      state: adjustNeutralBaseline(
        {
          ...state,
          rawAngle: angle,
          unwrappedAngle,
          filteredAngle,
          candidateAction: null,
          candidateCount: 0,
          neutralCount: 0,
        },
        delta,
        config,
      ),
      action: null,
      calibrated: true,
      delta,
      rearmed: false,
    };
  }

  const candidateCount =
    candidateAction === null ? 0 : candidateAction === state.candidateAction ? state.candidateCount + 1 : 1;
  const action = candidateCount >= config.confirmationSamples ? candidateAction : null;
  const nextState = adjustNeutralBaseline(
    {
      ...state,
      rawAngle: angle,
      unwrappedAngle,
      filteredAngle,
      armed: action === null,
      candidateAction: action === null ? candidateAction : null,
      candidateCount: action === null ? candidateCount : 0,
      neutralCount: 0,
    },
    delta,
    config,
  );

  return { state: nextState, action, calibrated: true, delta, rearmed: false };
}

function adjustNeutralBaseline(
  state: TiltDetectorState,
  delta: number,
  config: TiltDetectorConfig,
) {
  if (state.baseline === null || Math.abs(delta) > config.neutralAngle) return state;
  return {
    ...state,
    baseline: state.baseline + config.baselineAdjustmentFactor * delta,
  };
}

export function normalizeLandscapeTilt(
  gamma: number,
  orientation: number,
): number | null {
  if (orientation === 90) return gamma;
  if (orientation === -90) return -gamma;
  return null;
}

export function isLandscapeOrientation(orientation: number): orientation is LandscapeOrientation {
  return orientation === 90 || orientation === -90;
}

export function unwrapTiltAngle(
  angle: number,
  previousRawAngle: number | null,
  previousUnwrappedAngle: number | null,
) {
  if (previousRawAngle === null || previousUnwrappedAngle === null) return angle;
  let step = angle - previousRawAngle;
  while (step > Math.PI / 2) step -= Math.PI;
  while (step < -Math.PI / 2) step += Math.PI;
  return previousUnwrappedAngle + step;
}

export function isForeheadPosition(gravity: GravityVector, orientation: number) {
  const isLandscape = orientation === 90 || orientation === -90;
  const hasVerticalShortAxis = Math.abs(gravity.x) >= 6.5;
  const screenIsNotFlat = Math.abs(gravity.z) <= 6.5;
  return isLandscape && hasVerticalShortAxis && screenIsNotFlat;
}
