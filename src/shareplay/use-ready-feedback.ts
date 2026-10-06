import { useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSharePlay } from './session-provider';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';

/** Play feedback only for the local Ready tap, including when resuming. */
export function useSharePlayReadyFeedback() {
  const sharePlay = useSharePlay();
  const { prepareForSharePlay, playSharePlay } = useRoundSounds();
  const latest = useRef(sharePlay);
  useLayoutEffect(() => { latest.current = sharePlay; }, [sharePlay]);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const lastTap = useRef({ key: '', at: -Infinity });
  return () => {
    const current = latest.current;
    const view = current.game.view;
    const localId = current.session.localParticipantId;
    if (!view || !localId || current.busy || current.session.status !== 'joined' ||
      !['lobby', 'paused'].includes(view.phase) || view.ready.includes(localId) ||
      AppState.currentState !== 'active') return;
    const at = performance.now();
    const key = `${view.roundId}:${view.phase}`;
    if (lastTap.current.key === key && at - lastTap.current.at < 1500) return;
    lastTap.current = { key, at };
    const isCurrent = () => mounted.current && AppState.currentState === 'active' &&
      latest.current.session.status === 'joined' && latest.current.game.view?.roundId === view.roundId &&
      ['lobby', 'paused', 'countdown'].includes(latest.current.game.view.phase) &&
      performance.now() - at < 1000;
    void triggerRoundHaptic('card-flip', { cameraActive: false });
    void prepareForSharePlay(isCurrent).then((ready) => {
      if (ready && isCurrent()) void playSharePlay('pass', isCurrent);
    }).catch(() => undefined);
    current.gameActions.ready();
  };
}
