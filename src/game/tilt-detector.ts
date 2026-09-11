export type TiltAction = 'correct' | 'passed';

export type GravityVector = {
  x: number;
  y: number;
  z: number;
};

type MotionMeasurementLike = {
  accelerationIncludingGravity?: Partial<GravityVector> | null;
  rotation?: { gamma?: number | null } | null;
};

export type PortraitMotionSample = {
  gravity: GravityVector;
  angle: number;
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
  rearmUsingRawAngle?: boolean;
  triggerUsingRawAngle?: boolean;
  samplePeriodMs?: number;
  confirmationMs?: number;
  calibrationMs?: number;
};

export type TiltDetectorState = {
  baseline: number | null;
  rawAngle: number | null;
  unwrappedAngle: number | null;
  filteredAngle: number | null;
  calibrationTotal: number;
  calibrationCount: number;
  calibrationDurationMs: number;
  armed: boolean;
  candidateAction: TiltAction | null;
  candidateCount: number;
  candidateDurationMs: number;
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
  neutralAngle: 0.3,
  rearmSamples: 2,
  baselineAdjustmentFactor: 0.015,
};

export const ANDROID_TILT_CONFIG: TiltDetectorConfig = {
  ...DEFAULT_TILT_CONFIG,
  // Keep confirmation/filtering for scoring, but do not make returning to
  // center wait for the low-pass filter's tail after a deep tilt.
  rearmUsingRawAngle: true,
  rearmSamples: 1,
  // Preserve the filter response of the previous ~50 ms delivered cadence.
  samplePeriodMs: 50,
  // Discrete gestures need two real samples, not a smoothed orientation plus
  // a dwell timer. A filter tail must never score after the phone is centered.
  triggerUsingRawAngle: true,
  calibrationMs: 800,
};

export function createTiltDetectorState(baseline: number | null = null): TiltDetectorState {
  return {
    baseline,
    rawAngle: baseline,
    unwrappedAngle: baseline,
    filteredAngle: baseline,
    calibrationTotal: 0,
    calibrationCount: 0,
    calibrationDurationMs: 0,
    armed: true,
    candidateAction: null,
    candidateCount: 0,
    candidateDurationMs: 0,
    neutralCount: 0,
  };
}

export function updateTiltDetector(
  state: TiltDetectorState,
  angle: number,
  config = DEFAULT_TILT_CONFIG,
  canTrigger = true,
  elapsedMs = 50,
): TiltDetectorResult {
  const sampleMs = Math.max(0, Math.min(elapsedMs, config.samplePeriodMs ?? elapsedMs));
  const smoothingFactor = config.samplePeriodMs
    ? 1 - Math.pow(1 - config.smoothingFactor, sampleMs / config.samplePeriodMs)
    : config.smoothingFactor;
  if (config.samplePeriodMs) {
    config = {
      ...config,
      baselineAdjustmentFactor: 1 - Math.pow(1 - config.baselineAdjustmentFactor, sampleMs / config.samplePeriodMs),
      calibrationMovementTolerance: config.calibrationMovementTolerance * sampleMs / config.samplePeriodMs,
    };
  }
  const unwrappedAngle = unwrapTiltAngle(angle, state.rawAngle, state.unwrappedAngle);
  const movement = state.unwrappedAngle === null ? 0 : Math.abs(unwrappedAngle - state.unwrappedAngle);
  const filteredAngle =
    state.filteredAngle === null
      ? unwrappedAngle
      : state.filteredAngle + smoothingFactor * (unwrappedAngle - state.filteredAngle);

  if (state.baseline === null) {
    const stable = movement <= config.calibrationMovementTolerance;
    const calibrationCount = stable ? state.calibrationCount + 1 : 1;
    const calibrationTotal = stable ? state.calibrationTotal + filteredAngle : filteredAngle;
    const calibrationDurationMs = stable ? state.calibrationDurationMs + sampleMs : sampleMs;
    const calibrated = calibrationCount >= config.calibrationSamples && calibrationDurationMs >= (config.calibrationMs ?? 0);
    const baseline = calibrated ? calibrationTotal / calibrationCount : null;

    return {
      state: {
        ...state,
        baseline,
        rawAngle: angle,
        unwrappedAngle,
        filteredAngle,
        calibrationCount,
        calibrationDurationMs,
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
    const neutralDelta = config.rearmUsingRawAngle ? unwrappedAngle - state.baseline : delta;
    const neutralCount = Math.abs(neutralDelta) <= config.neutralAngle ? state.neutralCount + 1 : 0;
    const rearmed = neutralCount >= config.rearmSamples;
    return {
      state: {
        ...state,
        rawAngle: angle,
        unwrappedAngle,
        filteredAngle: rearmed && config.rearmUsingRawAngle ? unwrappedAngle : filteredAngle,
        armed: rearmed,
        candidateAction: null,
        candidateCount: 0,
        candidateDurationMs: 0,
        neutralCount,
      },
      action: null,
      calibrated: true,
      delta,
      rearmed,
    };
  }

  const triggerDelta = config.triggerUsingRawAngle ? unwrappedAngle - state.baseline : delta;
  const candidateAction =
    triggerDelta >= config.triggerAngle ? 'correct' : triggerDelta <= -config.triggerAngle ? 'passed' : null;

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
          candidateDurationMs: 0,
          neutralCount: 0,
        },
        triggerDelta,
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
  const candidateDurationMs = candidateAction !== null && candidateAction === state.candidateAction
    ? state.candidateDurationMs + sampleMs : 0;
  const action = candidateCount >= config.confirmationSamples &&
    candidateDurationMs >= (config.confirmationMs ?? 0) ? candidateAction : null;
  const nextState = adjustNeutralBaseline(
    {
      ...state,
      rawAngle: angle,
      unwrappedAngle,
      filteredAngle,
      armed: action === null,
      candidateAction: action === null ? candidateAction : null,
      candidateCount: action === null ? candidateCount : 0,
      candidateDurationMs: action === null ? candidateDurationMs : 0,
      neutralCount: 0,
    },
    triggerDelta,
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

export function normalizePortraitCanvasTilt(gamma: number) {
  // The native window is portrait while the game canvas is rotated clockwise.
  // Reverse gamma so a tilt toward the floor remains Correct in visual landscape.
  return -gamma;
}

export function getPortraitMotionSample(
  measurement: MotionMeasurementLike,
): PortraitMotionSample | null {
  const gravity = measurement.accelerationIncludingGravity;
  const gamma = measurement.rotation?.gamma;
  if (
    !gravity ||
    !Number.isFinite(gravity.x) ||
    !Number.isFinite(gravity.y) ||
    !Number.isFinite(gravity.z) ||
    !Number.isFinite(gamma)
  ) {
    return null;
  }
  return {
    gravity: {
      x: gravity.x as number,
      y: gravity.y as number,
      z: gravity.z as number,
    },
    angle: normalizePortraitCanvasTilt(gamma as number),
  };
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
