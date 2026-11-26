import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { RemoteView } from './remote-round';
import { sharePlayRoundCueRegistry } from './round-cues';
import { triggerRoundHaptic } from '@/utils/round-haptics';
import { useRoundSounds } from '@/video/round-sound-provider';

export function useSharePlayRoundCues(view: RemoteView | null, countdown: number,
  remainingMs: number, localId: string | null | undefined, visible: boolean) {
  const { playSharePlay, prepareForSharePlay, stopAll } = useRoundSounds();
  const latest = useRef({ view, countdown, remainingMs, localId, visible });
  useLayoutEffect(() => {
    latest.current = { view, countdown, remainingMs, localId, visible };
  }, [view, countdown, remainingMs, localId, visible]);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const preparation = useRef<Promise<boolean>>(Promise.resolve(false));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state !== 'active') stopAll();
    });
    return () => subscription.remove();
  }, [stopAll]);

  useEffect(() => {
    stopAll();
    let current = true;
    const eligible = () => current && AppState.currentState === 'active' &&
      latest.current.visible && !!latest.current.localId;
    preparation.current = !!localId && visible && active
      ? prepareForSharePlay(eligible) : Promise.resolve(false);
    return () => { current = false; stopAll(); };
  }, [active, localId, prepareForSharePlay, stopAll, visible]);

  useEffect(() => {
    const cues = view && localId
      ? sharePlayRoundCueRegistry.next(localId, view, countdown, remainingMs) : [];
    // Still consume hidden/inactive snapshots so returning to the screen cannot
    // replay transitions that happened while this device was not presenting it.
    if (!active || !visible || !view || !localId) { stopAll(); return; }
    if (['paused', 'lobby', 'ended'].includes(view.phase)) { stopAll(); return; }
    if (cues.some((cue) => cue.sound === 'round-end')) stopAll();
    const captured = { view, countdown, seconds: Math.ceil(remainingMs / 1000) };
    const current = () => {
      const now = latest.current;
      return AppState.currentState === 'active' && now.visible && now.localId === localId &&
        now.view?.roundId === captured.view.roundId &&
        now.view?.sessionId === captured.view.sessionId && now.view?.phase === captured.view.phase &&
        now.view?.revision === captured.view.revision && now.countdown === captured.countdown &&
        Math.ceil(now.remainingMs / 1000) === captured.seconds;
    };
    for (const cue of cues) {
      // Every participant handles the synchronized cue against local feedback
      // preferences; no preference or audio data crosses the session.
      if (cue.haptic) void triggerRoundHaptic(cue.haptic,
        { cameraActive: false, countdownValue: cue.countdownValue });
      void preparation.current.then((ready) => {
        if (ready && current()) void playSharePlay(cue.sound, current);
      });
    }
  }, [active, countdown, localId, playSharePlay, remainingMs, stopAll, view, visible]);
}
