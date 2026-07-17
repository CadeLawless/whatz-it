const VOLUME_CHANGE_EPSILON = 0.005;

// iOS communication sessions can stop at their lowest audible step instead of
// reaching digital zero. Treat that final 1/16 step as mute once the user has
// adjusted the recording-session volume during a round.
const IOS_COMMUNICATION_MUTE_FLOOR = 1 / 16 + VOLUME_CHANGE_EPSILON;

type RoundLiveVolumeState = {
  initialSessionVolume: number | null;
  lastSessionVolume: number | null;
  preferredVolume: number;
  unmutedAfterPreferredMute: boolean;
  userAdjustedSessionVolume: boolean;
};

let roundLiveVolumeState: RoundLiveVolumeState | null = null;

export function startRoundLiveVolumeControl(preferredVolume: number | null) {
  if (roundLiveVolumeState) return;
  const normalizedVolume = normalizeVolume(preferredVolume);
  roundLiveVolumeState =
    normalizedVolume === null
      ? null
      : {
          initialSessionVolume: null,
          lastSessionVolume: null,
          preferredVolume: normalizedVolume,
          unmutedAfterPreferredMute: false,
          userAdjustedSessionVolume: false,
        };
}

export function setInitialRoundSessionVolume(sessionVolume: number | null) {
  const normalizedVolume = normalizeVolume(sessionVolume);
  if (!roundLiveVolumeState || normalizedVolume === null) return;
  roundLiveVolumeState.initialSessionVolume = normalizedVolume;
  roundLiveVolumeState.lastSessionVolume = normalizedVolume;
}

export function stopRoundLiveVolumeControl() {
  roundLiveVolumeState = null;
}

export function isRoundLiveVolumeControlActive() {
  return roundLiveVolumeState !== null && roundLiveVolumeState.initialSessionVolume !== null;
}

export function getRoundLiveVolumeScale(sessionVolume: number | null) {
  const state = roundLiveVolumeState;
  const normalizedSessionVolume = normalizeVolume(sessionVolume);
  if (!state || state.initialSessionVolume === null || normalizedSessionVolume === null) return 1;

  if (Math.abs(normalizedSessionVolume - state.initialSessionVolume) > VOLUME_CHANGE_EPSILON) {
    state.userAdjustedSessionVolume = true;
  }
  if (
    state.preferredVolume <= VOLUME_CHANGE_EPSILON &&
    state.lastSessionVolume !== null &&
    normalizedSessionVolume - state.lastSessionVolume > VOLUME_CHANGE_EPSILON
  ) {
    state.unmutedAfterPreferredMute = true;
  }
  state.lastSessionVolume = normalizedSessionVolume;

  if (
    state.userAdjustedSessionVolume &&
    normalizedSessionVolume <= IOS_COMMUNICATION_MUTE_FLOOR
  ) return 0;

  if (state.preferredVolume <= VOLUME_CHANGE_EPSILON) {
    return state.unmutedAfterPreferredMute ? 1 : 0;
  }
  if (state.initialSessionVolume <= VOLUME_CHANGE_EPSILON) return 1;
  return Math.min(1, state.preferredVolume / state.initialSessionVolume);
}

function normalizeVolume(volume: number | null) {
  if (volume === null || !Number.isFinite(volume)) return null;
  return Math.max(0, Math.min(1, volume));
}
