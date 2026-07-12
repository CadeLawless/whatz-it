export type TiltAction = 'correct' | 'passed';

export type GravityVector = {
  x: number;
  y: number;
  z: number;
};

export type TiltDetectorConfig = {
  calibrationSamples: number;
  smoothingFactor: number;
  triggerAngle: number;
  neutralAngle: number;
};

export type TiltDetectorState = {
  baseline: number | null;
  filteredAngle: number | null;
  calibrationTotal: number;
  calibrationCount: number;
  armed: boolean;
};

export type TiltDetectorResult = {
  state: TiltDetectorState;
  action: TiltAction | null;
  calibrated: boolean;
  delta: number;
};

export const DEFAULT_TILT_CONFIG: TiltDetectorConfig = {
  calibrationSamples: 12,
  smoothingFactor: 0.24,
  triggerAngle: 0.62,
  neutralAngle: 0.22,
};

export function createTiltDetectorState(): TiltDetectorState {
  return {
    baseline: null,
    filteredAngle: null,
    calibrationTotal: 0,
    calibrationCount: 0,
    armed: true,
  };
}

export function updateTiltDetector(
  state: TiltDetectorState,
  angle: number,
  config = DEFAULT_TILT_CONFIG,
): TiltDetectorResult {
  const filteredAngle =
    state.filteredAngle === null
      ? angle
      : state.filteredAngle + config.smoothingFactor * (angle - state.filteredAngle);

  if (state.baseline === null) {
    const calibrationCount = state.calibrationCount + 1;
    const calibrationTotal = state.calibrationTotal + filteredAngle;
    const calibrated = calibrationCount >= config.calibrationSamples;
    const baseline = calibrated ? calibrationTotal / calibrationCount : null;

    return {
      state: {
        ...state,
        baseline,
        filteredAngle,
        calibrationCount,
        calibrationTotal,
      },
      action: null,
      calibrated,
      delta: 0,
    };
  }

  const delta = filteredAngle - state.baseline;

  if (!state.armed) {
    return {
      state: {
        ...state,
        filteredAngle,
        armed: Math.abs(delta) <= config.neutralAngle,
      },
      action: null,
      calibrated: true,
      delta,
    };
  }

  const action =
    delta >= config.triggerAngle ? 'correct' : delta <= -config.triggerAngle ? 'passed' : null;

  return {
    state: { ...state, filteredAngle, armed: action === null },
    action,
    calibrated: true,
    delta,
  };
}

export function normalizeLandscapeTilt(gamma: number, orientation: number) {
  return orientation === -90 ? -gamma : gamma;
}

export function isForeheadPosition(gravity: GravityVector, orientation: number) {
  const isLandscape = orientation === 90 || orientation === -90;
  const hasVerticalShortAxis = Math.abs(gravity.x) >= 6.5;
  const screenIsNotFlat = Math.abs(gravity.z) <= 6.5;
  return isLandscape && hasVerticalShortAxis && screenIsNotFlat;
}
