import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { useSharePlay } from '@/shareplay/session-provider';

export function SharePlayRejoinPrompt() {
  const sharePlay = useSharePlay();
  return (
    <ConfirmationPrompt
      embedded
      visible={sharePlay.rejoinOffered}
      title="Rejoin SharePlay?"
      message={sharePlay.error ?? 'Would you like to rejoin the SharePlay Lobby?'}
      cancelLabel="NO"
      confirmLabel="YES"
      busyLabel="JOINING..."
      busy={sharePlay.busy}
      onCancel={sharePlay.declineRejoin}
      onConfirm={() => { void sharePlay.acceptRejoin(); }}
    />
  );
}
