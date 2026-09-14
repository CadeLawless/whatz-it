import type { GravityVector } from '@/game/tilt-detector';

export type RoundDevicePosture = 'landscape' | 'portrait';
export type RoundPostureZone = RoundDevicePosture | 'other';

export type RoundPostureDetectorConfig = {
  portraitMinimumGravity: number;
  portraitDominanceRatio: number;
  portraitMaximumDepthGravity: number;
  portraitConfirmationMs: number;
  landscapeMinimumGravity: number;
  landscapeDominanceRatio: number;
  landscapeMaximumDepthGravity: number;
  landscapeConfirmationMs: number;
};

export type RoundPostureDetectorState = {
  posture: RoundDevicePosture;
  zone: RoundPostureZone;
  candidate: RoundDevicePosture | null;
  candidateDurationMs: number;
};

export type RoundPostureDetectorResult = {
  state: RoundPostureDetectorState;
  changed: boolean;
};

export const DEFAULT_ROUND_POSTURE_CONFIG: RoundPostureDetectorConfig = {
  // Portrait must be unmistakable before it can interrupt play. Correct/Pass
  // rotate around the portrait Y axis, so Y remains small during normal play.
  // A phone being read in the hand is commonly tilted toward the user's face,
  // so much of gravity can be on Z. Y dominance over X is the important part:
  // Correct/Pass rotate around Y and keep this value close to zero.
  portraitMinimumGravity: 4.2,
  portraitDominanceRatio: 1.35,
  portraitMaximumDepthGravity: 9.2,
  portraitConfirmationMs: 350,
  // Returning to the forehead is intentionally slower so the round cannot
  // resume while the player is still moving the phone into place.
  landscapeMinimumGravity: 6.5,
  landscapeDominanceRatio: 1.35,
  landscapeMaximumDepthGravity: 6.5,
  landscapeConfirmationMs: 650,
};

export function createRoundPostureDetectorState(
  posture: RoundDevicePosture = 'landscape',
): RoundPostureDetectorState {
  return {
    posture,
    zone: 'other',
    candidate: null,
    candidateDurationMs: 0,
  };
}

export function classifyRoundPosture(
  gravity: GravityVector,
  config = DEFAULT_ROUND_POSTURE_CONFIG,
): RoundPostureZone {
  const x = Math.abs(gravity.x);
  const y = Math.abs(gravity.y);
  const z = Math.abs(gravity.z);

  if (
    y >= config.portraitMinimumGravity &&
    y >= x * config.portraitDominanceRatio &&
    z <= config.portraitMaximumDepthGravity
  ) {
    return 'portrait';
  }

  if (
    x >= config.landscapeMinimumGravity &&
    x >= y * config.landscapeDominanceRatio &&
    z <= config.landscapeMaximumDepthGravity
  ) {
    return 'landscape';
  }

  return 'other';
}

export function updateRoundPostureDetector(
  state: RoundPostureDetectorState,
  gravity: GravityVector,
  elapsedMs: number,
  config = DEFAULT_ROUND_POSTURE_CONFIG,
): RoundPostureDetectorResult {
  const zone = classifyRoundPosture(gravity, config);
  if (zone === 'other' || zone === state.posture) {
    return {
      state: {
        ...state,
        zone,
        candidate: null,
        candidateDurationMs: 0,
      },
      changed: false,
    };
  }

  const candidateDurationMs =
    state.candidate === zone
      ? state.candidateDurationMs + Math.max(0, Math.min(elapsedMs, 100))
      : Math.max(0, Math.min(elapsedMs, 100));
  const confirmationMs =
    zone === 'portrait' ? config.portraitConfirmationMs : config.landscapeConfirmationMs;
  if (candidateDurationMs < confirmationMs) {
    return {
      state: {
        ...state,
        zone,
        candidate: zone,
        candidateDurationMs,
      },
      changed: false,
    };
  }

  return {
    state: {
      posture: zone,
      zone,
      candidate: null,
      candidateDurationMs: 0,
    },
    changed: true,
  };
}
