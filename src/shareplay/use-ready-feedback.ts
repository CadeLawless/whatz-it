import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useSharePlay } from './session-provider';
import { SharePlayReadinessFeedback } from './readiness-feedback';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';

/** Tap feedback stays on the phone that readies, including when resuming. */
export function useSharePlayReadyFeedback(observeUnready = false) {
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
  const readiness = useRef(new SharePlayReadinessFeedback());
  useEffect(() => {
    if (!observeUnready) return;
    const { session, game, decks } = sharePlay;
    const identity = session.status === 'joined' && session.localParticipantId
      ? `${session.sessionId}:${session.localParticipantId}` : null;
    const ready = game.view ? game.view.ready.includes(session.localParticipantId ?? '') :
      decks.selectedDeckId === null ? false : null;
    if (!readiness.current.update(identity, ready, game.view?.phase) || identity === null ||
      AppState.currentState !== 'active' || ['results', 'ended'].includes(game.view?.phase ?? '')) return;
    lastTap.current = { key: '', at: -Infinity };
    const at = performance.now();
    const isCurrent = () => mounted.current && AppState.currentState === 'active' &&
      latest.current.session.status === 'joined' &&
      `${latest.current.session.sessionId}:${latest.current.session.localParticipantId}` === identity &&
      !latest.current.game.view?.ready.includes(session.localParticipantId ?? '') &&
      !['results', 'ended'].includes(latest.current.game.view?.phase ?? '') && performance.now() - at < 1000;
    void triggerRoundHaptic('card-flip', { cameraActive: false });
    void prepareForSharePlay(isCurrent).then((prepared) => {
      if (prepared && isCurrent()) void playSharePlay('flip', isCurrent);
    }).catch(() => undefined);
  }, [observeUnready, playSharePlay, prepareForSharePlay, sharePlay]);
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
