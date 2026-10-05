export type SharePlayInvitation = {
  protocolVersion: 4;
  environment: string;
  nonce: string;
  deckId: string;
  deckTitle: string;
  durationSeconds: number;
};
export type SharePlayActivity = SharePlayInvitation & { hostPublicKey: string };
export type SharePlaySnapshot = {
  revision: number;
  status: 'idle' | 'waiting' | 'joined' | 'ended';
  sessionId: string | null;
  localParticipantId: string | null;
  participantIds: string[];
  isHost: boolean;
  hostParticipantId: string | null;
  /** JS-only: host authority was reassigned or recovered after a restart. */
  electedHost?: boolean;
  /** JS-only authority generation, shared in host claims and handoffs. */
  hostTerm?: number;
  activity: SharePlayActivity | null;
};
export type SharePlayMessage = {
  sessionId: string;
  senderId: string;
  body: string;
  senderIsHost: boolean;
};
export type WhatzItSharePlayModuleEvents = {
  onSession: (snapshot: SharePlaySnapshot) => void;
  onMessage: (message: SharePlayMessage) => void;
  onError: (error: { code: string; detail?: string }) => void;
  onDiagnostic: (event: { stage: string; status?: string; session?: string; participant?: string;
    members?: number; isHost?: boolean; kind?: string; bytes?: number; recipients?: number;
    code?: string; result?: string }) => void;
};
