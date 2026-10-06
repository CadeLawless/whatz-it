import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';
import NativeSharePlay from '../../modules/whatz-it-shareplay/src/WhatzItSharePlayModule';
import type { SharePlayActivity, SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { ConnectionProbe, type PeerConnection } from './connection-probe';
import { setSharePlayAudioBlocked } from './audio-policy';
import { useCatalog } from '@/catalog/catalog-provider';
import { loadRoundCardIds, rememberSharedCard } from '@/storage/daily-card-memory';
import { useOwnedDeckIds } from '@/storefront/commerce-provider';
import { canShareDeck } from './deck-access';
import { LiveGame } from './live-game';
import { endSharePlaySession, isLastSharePlayParticipant } from './end-session';
import { REJOIN_SESSION_KEY, SharePlayParticipation, shouldOfferSharePlayRejoin } from './participation';
import { parseGameWire } from './game-wire';
import type { RemoteOutcome, RemoteView } from './remote-round';
import type { GameMode } from '../game/game-types';
import { logSharePlay, shortSharePlayId, SHAREPLAY_RUNTIME_REVISION } from './diagnostics';
import { cleanPlayerName, encodePlayerName, parsePlayerName } from './player-names';
import { acceptsSharePlayHostClaim, recoveryHost, resolveSharePlayHost, shouldRecoverSharePlayHost } from './host-election';

const enabled = Platform.OS === 'ios' && process.env.EXPO_PUBLIC_SHAREPLAY_DISABLED !== 'true' &&
  (__DEV__ || Constants.expoConfig?.extra?.sharePlayPrototypeEnabled === true);
const environment = String(Constants.expoConfig?.extra?.sharePlayEnvironment ?? 'main:production');
const PLAYER_NAME_KEY = 'shareplay.player-name.v1';
const emptySession: SharePlaySnapshot = {
  revision: -1, status: 'idle', sessionId: null, localParticipantId: null,
  participantIds: [], isHost: false, hostParticipantId: null, activity: null,
};
type Setup = Pick<SharePlayActivity, 'deckId' | 'deckTitle' | 'durationSeconds'> & { access: 'free' | 'paid' };
type SharePlayContextValue = {
  enabled: boolean;
  available: boolean;
  isOpen: boolean;
  busy: boolean;
  initialized: boolean;
  canInvite: boolean;
  invitationPending: boolean;
  error: string | null;
  setup: Setup | null;
  session: SharePlaySnapshot;
  peers: Record<string, PeerConnection>;
  playerNames: Record<string, string>;
  localPlayerName: string;
  playerNameLoaded: boolean;
  setLocalPlayerName: (name: string) => void;
  game: { view: RemoteView | null; synchronized: boolean; remainingMs: number; countdown: number };
  decks: { selectedDeckId: string | null; availableDeckIds: string[]; durationSeconds: number; mode: GameMode };
  gameVisible: boolean;
  rejoinOffered: boolean;
  acceptRejoin: () => Promise<void>;
  declineRejoin: () => void;
  gameActions: {
    ready: () => void; start: () => void; pause: () => void; resume: () => void;
    answer: (outcome: RemoteOutcome) => void;
    selectMode: (mode: GameMode) => void;
    selectGuesser: (guesserId: string) => void;
    selectDeck: (deckId: string) => void;
    selectDuration: (seconds: number) => void;
    returnToLobby: () => void;
    nextRound: () => void;
    endGame: () => void;
  };
  closeGame: () => void;
  open: (setup: Setup) => void;
  updateSetupDuration: (seconds: number) => void;
  updateSetupDeck: (deckId: string) => void;
  close: () => void;
  invite: () => Promise<void>;
  join: () => Promise<void>;
  leave: (endForEveryone?: boolean) => Promise<void>;
  checkConnection: () => Promise<void>;
};
const SharePlayContext = createContext<SharePlayContextValue | null>(null);

export function SharePlayProvider({ children }: PropsWithChildren) {
  const { catalog } = useCatalog();
  const ownedDeckIds = useOwnedDeckIds();
  const [session, setSession] = useState(emptySession);
  const sessionRef = useRef(emptySession);
  const hostElectionActive = useRef(false);
  const electedHostId = useRef<string | null>(null);
  const hostTerm = useRef(0);
  const lastHostSeenAt = useRef(0);
  const nativeSessionRef = useRef(emptySession);
  const participation = useRef(new SharePlayParticipation());
  const presenceSequence = useRef(0);
  const startupPending = useRef(true);
  const savedRejoinNonce = useRef<string | null>(null);
  const startupRejoinChecked = useRef(false);
  const presenceAnnouncement = useRef('');
  const [rejoinOffered, setRejoinOffered] = useState(false);
  const rejoinSession = useRef<string | null>(null);
  const applySnapshotRef = useRef<(snapshot: SharePlaySnapshot, electUnknownHost?: boolean) => void>(() => undefined);
  const probe = useRef<ConnectionProbe | null>(null);
  const lastProbeAt = useRef<Record<string, number>>({});
  const lastPeerSummary = useRef('');
  const [peers, setPeers] = useState<Record<string, PeerConnection>>({});
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [localPlayerName, setLocalPlayerNameState] = useState('');
  const [playerNameLoaded, setPlayerNameLoaded] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [initialized, setInitialized] = useState(false);
  const [invitationPending, setInvitationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canInvite = !!catalog.getDeckById(setup?.deckId);
  const catalogRef = useRef(catalog);
  const ownedDeckIdsRef = useRef(ownedDeckIds);
  const [game, setGame] = useState<{ view: RemoteView | null; synchronized: boolean; remainingMs: number; countdown: number }>({
    view: null, synchronized: false, remainingMs: 0, countdown: 0,
  });
  const [gameVisible, setGameVisible] = useState(false);
  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(PLAYER_NAME_KEY).then((saved) => {
      if (alive && saved) setLocalPlayerNameState(cleanPlayerName(saved));
    }).catch(() => undefined).finally(() => { if (alive) setPlayerNameLoaded(true); });
    return () => { alive = false; };
  }, []);
  const [decks, setDecks] = useState<{ selectedDeckId: string | null; availableDeckIds: string[]; durationSeconds: number; mode: GameMode }>({
    selectedDeckId: null, availableDeckIds: [], durationSeconds: 60, mode: 'classic',
  });
  const gameActive = useRef(false);
  const manualLobby = useRef(false);
  const liveGame = useRef<LiveGame | null>(null);
  const endGameRef = useRef<() => void>(() => undefined);
  useEffect(() => { liveGame.current = new LiveGame({
    environment,
    trace: logSharePlay,
    uuid: randomUUID,
    digest: (value) => digestStringAsync(CryptoDigestAlgorithm.SHA256, value),
    send: (body, recipients) => {
      if (!NativeSharePlay) return Promise.reject(new Error('SharePlay unavailable'));
      return NativeSharePlay.sendAsync(body, recipients);
    },
    cards: async (deckId) => {
      const deck = catalogRef.current.getDeckById(deckId);
      if (!canShareDeck(deck, ownedDeckIdsRef.current)) return null;
      const eligibleIds = new Set(await loadRoundCardIds(deck!.cards, catalogRef.current.decks));
      return deck!.cards.filter((card) => eligibleIds.has(card.id))
        .map((card) => ({ answer: card.text, byline: card.byline ?? '' }));
    },
    onCardSeen: (card) => {
      void rememberSharedCard({ text: card.answer, byline: card.byline || undefined },
        catalogRef.current.decks);
    },
    availableDeckIds: () => catalogRef.current.decks
      .filter((deck) => canShareDeck(deck, ownedDeckIdsRef.current)).map((deck) => deck.id),
    onDecks: (selectedDeckId, availableDeckIds, durationSeconds, mode) =>
      setDecks({ selectedDeckId, availableDeckIds, durationSeconds, mode }),
    onView: (view) => {
      if (view?.phase === 'lobby' && sessionRef.current.status === 'joined') {
        gameActive.current = false; manualLobby.current = false;
        setGameVisible(false); setOpen(true);
      }
      setGame({ view, synchronized: liveGame.current?.synchronized ?? false,
        remainingMs: liveGame.current?.remainingMs ?? 0, countdown: liveGame.current?.countdown ?? 0 });
    },
    onError: (message) => {
      if (sessionRef.current.status !== 'joined' || operation.current) return;
      logSharePlay('game.error', { code: 'game-callback' }, true); setError(message);
    },
    onActive: (phase) => {
      if (startupPending.current || sessionRef.current.status !== 'joined') return;
      if (manualLobby.current && phase !== 'countdown') return;
      if (phase === 'countdown') manualLobby.current = false;
      if (gameActive.current) return;
      gameActive.current = true;
      setOpen(false);
      setGameVisible(true);
    },
    onLobby: () => {
      if (startupPending.current || sessionRef.current.status !== 'joined') return;
      manualLobby.current = false;
      gameActive.current = false;
      setGameVisible(false); setOpen(true);
    },
    onHostActivity: () => { lastHostSeenAt.current = performance.now(); },
    onSessionEnd: () => {
      const native = NativeSharePlay;
      if (!native) return;
      void native.leaveAsync().then(() => native.getSnapshotAsync()).then((snapshot) => {
        applySnapshotRef.current(snapshot);
        gameActive.current = false; manualLobby.current = false;
        setGameVisible(false); setOpen(false); setError(null); setSharePlayAudioBlocked(false);
        setRejoinOffered(false); rejoinSession.current = null;
        void AsyncStorage.removeItem(REJOIN_SESSION_KEY).catch(() => undefined);
      }).catch((error) => logSharePlay('session.end-receive-failed',
        { code: String(error?.code ?? 'native-leave-failed') }, true));
    },
    onEndGame: () => endGameRef.current(),
    onHostClaim: (participantId, signed, term) => {
      const native = nativeSessionRef.current;
      if (native.status !== 'joined' || !participation.current.isActive(participantId) ||
        !native.participantIds.includes(participantId)) return;
      if (!acceptsSharePlayHostClaim(sessionRef.current.hostParticipantId, hostTerm.current,
        participantId, term, signed)) return;
      lastHostSeenAt.current = performance.now();
      if (sessionRef.current.hostParticipantId === participantId && hostTerm.current === term) return;
      hostTerm.current = term;
      electedHostId.current = participantId;
      hostElectionActive.current = true;
      applySnapshotRef.current(native, true);
    },
    onHostTransfer: (participantId, term) => {
      const native = nativeSessionRef.current;
      if (native.status !== 'joined' || !participation.current.isActive(participantId) ||
        !native.participantIds.includes(participantId) ||
        term <= hostTerm.current) return;
      hostTerm.current = term;
      lastHostSeenAt.current = performance.now();
      electedHostId.current = participantId;
      hostElectionActive.current = true;
      applySnapshotRef.current(native, true);
      logSharePlay('host.transferred', { participant: shortSharePlayId(participantId) });
    },
  }); }, []);
  useEffect(() => {
    catalogRef.current = catalog;
    ownedDeckIdsRef.current = ownedDeckIds;
    liveGame.current?.refreshAvailableDecks();
    if (sessionRef.current.status === 'joined' && sessionRef.current.isHost) {
      liveGame.current?.setSession(sessionRef.current);
    }
  }, [catalog, ownedDeckIds]);

  const applySnapshot = useCallback((incoming: SharePlaySnapshot, electUnknownHost = false) => {
    if (!('hostParticipantId' in incoming)) {
      logSharePlay('session.incompatible-snapshot', {}, true);
      setError('Install the latest SharePlay development build on both phones before inviting friends.');
      return;
    }
    if (incoming.revision < sessionRef.current.revision) {
      logSharePlay('session.stale-snapshot', { revision: incoming.revision }, true); return;
    }
    nativeSessionRef.current = incoming;
    if (startupPending.current) return;
    const previous = sessionRef.current;
    if (incoming.sessionId !== previous.sessionId) {
      hostElectionActive.current = false;
      electedHostId.current = null;
      hostTerm.current = 0;
      lastHostSeenAt.current = performance.now();
    }
    participation.current.sync(incoming);
    if (!startupRejoinChecked.current && incoming.sessionId &&
      ['joined', 'waiting'].includes(incoming.status)) {
      startupRejoinChecked.current = true;
      if (shouldOfferSharePlayRejoin(incoming, savedRejoinNonce.current)) {
        participation.current.exclude(incoming.localParticipantId!);
        rejoinSession.current = incoming.sessionId;
        setRejoinOffered(true); setOpen(false); setGameVisible(false);
        logSharePlay('rejoin.offered', { source: 'cold-launch' });
      }
    }
    const active = participation.current.project(incoming);
    const resolved = resolveSharePlayHost(active, hostElectionActive.current || electUnknownHost,
      electedHostId.current);
    if (resolved.electedHost) {
      if (resolved.hostParticipantId !== electedHostId.current) hostTerm.current++;
      hostElectionActive.current = true;
      electedHostId.current = resolved.hostParticipantId;
    }
    const withdrawn = (incoming.status === 'joined' || incoming.status === 'waiting') &&
      !participation.current.isActive(incoming.localParticipantId);
    const next = { ...resolved, status: withdrawn ? 'idle' as const : resolved.status,
      isHost: !withdrawn && resolved.isHost, hostTerm: hostTerm.current };
    if (incoming.status === 'joined' && NativeSharePlay) {
      const recipients = incoming.participantIds.filter((id) => id !== incoming.localParticipantId);
      const key = `${incoming.sessionId}:${!withdrawn}:${recipients.join(',')}`;
      if (recipients.length && presenceAnnouncement.current !== key) {
        presenceAnnouncement.current = key;
        const sequence = Math.max(Date.now(), presenceSequence.current + 1);
        presenceSequence.current = sequence;
        void NativeSharePlay.sendAsync(JSON.stringify({ version: 3, kind: 'presence', active: !withdrawn, sequence }),
          recipients).catch(() => { presenceAnnouncement.current = ''; });
      }
    } else presenceAnnouncement.current = '';
    if (next.revision !== previous.revision || next.status !== previous.status) {
      logSharePlay('session.snapshot', { status: next.status, revision: next.revision,
        session: shortSharePlayId(next.sessionId), participant: shortSharePlayId(next.localParticipantId),
        members: next.participantIds.length, isHost: next.isHost });
    }
    if (next.hostParticipantId !== previous.hostParticipantId && next.hostParticipantId) {
      lastHostSeenAt.current = performance.now();
      logSharePlay('host.changed', { participant: shortSharePlayId(next.hostParticipantId),
        isHost: next.isHost, revision: hostTerm.current });
    }
    sessionRef.current = next;
    liveGame.current?.setSession(next);
    if (next.sessionId !== previous.sessionId) {
      setPlayerNames({});
      lastPeerSummary.current = '';
      probe.current = next.sessionId ? new ConnectionProbe(next.sessionId, environment) : null;
      lastProbeAt.current = {};
    }
    probe.current?.setPeers(next.participantIds.filter((id) => id !== next.localParticipantId));
    setPeers(probe.current?.snapshot() ?? {});
    setSession(next);
    if (next.sessionId || next.status === 'ended') setInvitationPending(false);
    if (next.status === 'joined' && !withdrawn && !startupPending.current && incoming.activity?.nonce) {
      void AsyncStorage.setItem(REJOIN_SESSION_KEY, incoming.activity.nonce).catch(() => undefined);
    }
    if (next.sessionId && !gameActive.current && !withdrawn && !startupPending.current) {
      setSharePlayAudioBlocked(true);
      setOpen(true);
    }
    if (next.status === 'ended') {
      setRejoinOffered(false); rejoinSession.current = null;
      void AsyncStorage.removeItem(REJOIN_SESSION_KEY).catch(() => undefined);
      logSharePlay('session.ended', { session: shortSharePlayId(next.sessionId) }, true);
      gameActive.current = false; manualLobby.current = false; setGameVisible(false);
      setError(null); setOpen(false); setSharePlayAudioBlocked(false);
    }
  }, []);
  useEffect(() => { applySnapshotRef.current = applySnapshot; }, [applySnapshot]);

  const sendPresence = useCallback((active: boolean) => {
    const native = nativeSessionRef.current;
    if (!NativeSharePlay || !['joined', 'waiting'].includes(native.status) || !native.localParticipantId)
      return Promise.resolve();
    const sequence = Math.max(Date.now(), presenceSequence.current + 1);
    presenceSequence.current = sequence;
    participation.current.update(native.localParticipantId, active, sequence);
    const recipients = native.participantIds.filter((id) => id !== native.localParticipantId);
    const sent = native.status === 'joined' && recipients.length ? NativeSharePlay.sendAsync(JSON.stringify({ version: 3,
      kind: 'presence', active, sequence }), recipients) : Promise.resolve();
    applySnapshotRef.current(native, true);
    return sent;
  }, []);

  useEffect(() => {
    if (!NativeSharePlay || session.status !== 'joined' || !session.sessionId ||
      session.hostParticipantId || session.isHost) return;
    const native = NativeSharePlay;
    // The inviter's signed messages normally identify them first. If someone joins
    // after that inviter left, elect from the remaining roster after a short grace period.
    const timeout = setTimeout(() => {
      void native.getSnapshotAsync().then((snapshot) => applySnapshot(snapshot, true))
        .catch(() => logSharePlay('host.election-refresh-failed', {}, true));
    }, 2500);
    return () => clearTimeout(timeout);
  }, [applySnapshot, session.hostParticipantId, session.isHost, session.sessionId, session.status]);

  useEffect(() => {
    if (!NativeSharePlay) return;
    if (!enabled) {
      void NativeSharePlay.stopAsync().catch(() => undefined);
      return;
    }
    let alive = true;
    const subscriptions = [
      NativeSharePlay.addListener('onDiagnostic', (event) => {
        if (!alive) return;
        const { stage, ...details } = event;
        logSharePlay(`native.${stage}`, details);
      }),
      NativeSharePlay.addListener('onSession', (value) => { if (alive) applySnapshot(value); }),
      NativeSharePlay.addListener('onError', (failure) => {
        if (alive) {
          if (failure.code === 'sessionInvalidated') {
            logSharePlay('session.invalidated', { code: failure.code });
            gameActive.current = false; manualLobby.current = false;
            setGameVisible(false); setOpen(false); setError(null); setSharePlayAudioBlocked(false);
            return;
          }
          logSharePlay('native.error', { code: failure.code }, true);
          setError(failure.code === 'sessionInvalidated'
            ? `SharePlay session ended: ${failure.detail ?? 'The call or shared activity ended.'}`
            : 'This invitation uses a different test build or environment. Use matching builds on both phones.');
          setOpen(true);
        }
      }),
      NativeSharePlay.addListener('onMessage', (message) => {
        if (startupPending.current) return;
        const native = nativeSessionRef.current;
        const wire = parseGameWire(message.body);
        if (alive && native.status === 'joined' && message.sessionId === native.sessionId &&
          native.participantIds.includes(message.senderId)) {
          if (wire?.kind === 'presence') {
            if (participation.current.update(message.senderId, wire.active, wire.sequence))
              applySnapshotRef.current(native, true);
            return;
          }
          if (wire?.kind === 'host-claim' && sessionRef.current.status !== 'joined') {
            const term = wire.term ?? 0;
            if (participation.current.isActive(message.senderId) && acceptsSharePlayHostClaim(
              sessionRef.current.hostParticipantId, hostTerm.current, message.senderId, term, message.senderIsHost)) {
              hostTerm.current = term; electedHostId.current = message.senderId; hostElectionActive.current = true;
              applySnapshotRef.current(native, true);
            }
            return;
          }
          if (wire?.kind === 'session-end' && sessionRef.current.status !== 'joined' &&
            message.senderId === sessionRef.current.hostParticipantId && wire.term === hostTerm.current) {
            void NativeSharePlay?.leaveAsync().then(() => NativeSharePlay?.getSnapshotAsync())
              .then((snapshot) => { if (snapshot) applySnapshotRef.current(snapshot);
                setRejoinOffered(false); rejoinSession.current = null;
                void AsyncStorage.removeItem(REJOIN_SESSION_KEY).catch(() => undefined);
              }).catch((error) => logSharePlay('session.end-receive-failed', { code: String(error) }, true));
            return;
          }
        }
        if (!alive || sessionRef.current.status !== 'joined') {
          logSharePlay('wire.ignored', { code: 'provider-not-joined' }, true); return;
        }
        const incomingName = parsePlayerName(message.body);
        if (incomingName !== null && message.sessionId === sessionRef.current.sessionId &&
          sessionRef.current.participantIds.includes(message.senderId) &&
          message.senderId !== sessionRef.current.localParticipantId) {
          setPlayerNames((current) => ({ ...current, [message.senderId]: incomingName }));
          return;
        }
        liveGame.current?.receive(message);
        const reply = probe.current?.receive(message.sessionId, message.senderId, message.body, performance.now());
        const statuses = probe.current?.snapshot() ?? {};
        const summary = Object.entries(statuses).map(([id, status]) => `${shortSharePlayId(id)}:${status}`).sort().join(',');
        if (summary !== lastPeerSummary.current) {
          lastPeerSummary.current = summary;
          logSharePlay('connection.status', { members: Object.keys(statuses).length,
            ready: Object.values(statuses).filter((status) => status === 'confirmed').length,
            result: Object.values(statuses).sort().join(',') });
        }
        setPeers(statuses);
        if (reply) void NativeSharePlay?.sendAsync(reply, [message.senderId]).catch(() => {
          logSharePlay('connection.reply-failed', { participant: shortSharePlayId(message.senderId) }, true);
          if (alive) setError('A connection reply could not be sent. Try checking the connection again.');
        });
      }),
    ];
    logSharePlay('runtime.loaded', { code: SHAREPLAY_RUNTIME_REVISION });
    logSharePlay('native.start', { source: 'provider' });
    void AsyncStorage.getItem(REJOIN_SESSION_KEY).catch(() => null).then((savedSession) => {
      savedRejoinNonce.current = savedSession;
      return NativeSharePlay!.startAsync(environment);
    }).then((value) => {
      if (alive) {
        startupPending.current = false;
        applySnapshot(nativeSessionRef.current.revision > value.revision ? nativeSessionRef.current : value);
        setInitialized(true);
      }
    }).catch(() => {
      logSharePlay('native.start-failed', {}, true);
      if (alive) setError('SharePlay could not start in this build. Install a development build with SharePlay enabled and try again.');
    });
    const foreground = AppState.addEventListener('change', (state) => {
      logSharePlay('app.state', { foreground: state === 'active' });
      liveGame.current?.setForeground(state === 'active');
      if (state === 'active') void NativeSharePlay?.getSnapshotAsync().then((value) => {
        if (alive) {
          applySnapshot(value);
        }
      }).catch(() => { logSharePlay('session.refresh-failed', {}, true);
        if (alive) setError('Could not reconnect to SharePlay. Leave and try a new invitation.'); });
    });
    const timer = setInterval(() => {
      const now = performance.now();
      probe.current?.expire(now);
      const peerStatuses = probe.current?.snapshot() ?? {};
      const peerSummary = Object.entries(peerStatuses).map(([id, status]) => `${shortSharePlayId(id)}:${status}`).sort().join(',');
      if (peerSummary !== lastPeerSummary.current) {
        lastPeerSummary.current = peerSummary;
        logSharePlay('connection.status', { members: Object.keys(peerStatuses).length,
          ready: Object.values(peerStatuses).filter((status) => status === 'confirmed').length,
          result: Object.values(peerStatuses).sort().join(',') });
      }
      const current = sessionRef.current;
      if (alive && current.status === 'joined' && NativeSharePlay && probe.current) {
        const statuses = probe.current.snapshot();
        if (shouldRecoverSharePlayHost(current, lastHostSeenAt.current, now, AppState.currentState === 'active')) {
          const participantId = recoveryHost(current,
            Object.entries(statuses).filter(([, status]) => status === 'confirmed').map(([id]) => id));
          if (participantId) {
            hostTerm.current++;
            electedHostId.current = participantId;
            hostElectionActive.current = true;
            lastHostSeenAt.current = now;
            logSharePlay('host.recovery', { participant: shortSharePlayId(participantId),
              revision: hostTerm.current, code: 'heartbeat-timeout' }, true);
            applySnapshotRef.current(nativeSessionRef.current, true);
          }
        }
        for (const id of current.participantIds) {
          if (id === current.localParticipantId || statuses[id] === 'checking' ||
            now - (lastProbeAt.current[id] ?? -Infinity) < 6_000) continue;
          const body = probe.current.begin(id, randomUUID(), now);
          if (!body) continue;
          lastProbeAt.current[id] = now;
          logSharePlay('connection.probe', { participant: shortSharePlayId(id) });
          void NativeSharePlay.sendAsync(body, [id]).catch(() => {
            logSharePlay('connection.probe-failed', { participant: shortSharePlayId(id) }, true);
          });
        }
      }
      if (alive && probe.current) setPeers(probe.current.snapshot());
      liveGame.current?.pulse();
      if (alive && liveGame.current) setGame({ view: liveGame.current.currentView,
        synchronized: liveGame.current.synchronized, remainingMs: liveGame.current.remainingMs,
        countdown: liveGame.current.countdown });
    }, 500);
    return () => {
      alive = false;
      subscriptions.forEach((subscription) => subscription.remove());
      foreground.remove(); clearInterval(timer);
      // Native observer is idempotent and retains current state across JS refreshes.
      // Native module keeps the current session through a JS refresh.
    };
  }, [applySnapshot, sendPresence]);

  useEffect(() => {
    setSharePlayAudioBlocked(isOpen || busy || session.status === 'waiting' || session.status === 'joined');
  }, [busy, isOpen, session.status]);
  useEffect(() => () => setSharePlayAudioBlocked(false), []);

  const gamePhase = game.view?.phase;
  useEffect(() => {
    if (!NativeSharePlay || session.status !== 'joined' || !session.localParticipantId ||
      !localPlayerName) return;
    const native = NativeSharePlay;
    const recipients = session.participantIds.filter((id) => id !== session.localParticipantId);
    if (!recipients.length) return;
    const sendName = () => {
      void native.sendAsync(encodePlayerName(localPlayerName), recipients).catch(() => {
        logSharePlay('player-name.send-failed', { recipients: recipients.length }, true);
      });
    };
    sendName();
    if (gamePhase && gamePhase !== 'lobby') return;
    const retry = setInterval(sendName, 8000);
    return () => clearInterval(retry);
  }, [localPlayerName, session.status, session.sessionId, session.localParticipantId,
    session.participantIds, gamePhase]);

  useEffect(() => {
    const lobby = game.view;
    if (session.status !== 'joined' || !session.isHost || !lobby || !['lobby', 'paused'].includes(lobby.phase) ||
      decks.selectedDeckId !== lobby.deck.deckId ||
      lobby.participants.length < 2 || !session.localParticipantId) return;
    if (lobby.participants.every((id) => lobby.ready.includes(id) &&
      !!(id === session.localParticipantId ? localPlayerName : playerNames[id]))) {
      liveGame.current?.act(lobby.phase === 'paused' ? 'resume' : 'start');
    }
  }, [decks.selectedDeckId, game.view, localPlayerName, playerNames, session.isHost, session.localParticipantId, session.status]);

  const run = async (name: string, action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    logSharePlay('operation.start', { kind: name, source: SHAREPLAY_RUNTIME_REVISION,
      isHost: sessionRef.current.isHost, revision: hostTerm.current });
    try { await action(); logSharePlay('operation.success', { kind: name }); }
    catch (error) { logSharePlay('operation.failed', { kind: name,
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : String(error) }, true);
      setError('SharePlay could not complete that action. Check FaceTime and your connection, then try again.'); }
    finally { operation.current = false; setBusy(false); }
  };

  const value: SharePlayContextValue = {
    enabled, available: !!NativeSharePlay, isOpen, busy, initialized, canInvite, invitationPending,
    error, setup, session, peers,
    rejoinOffered,
    declineRejoin: () => {
      logSharePlay('rejoin.declined');
      setRejoinOffered(false); setOpen(false); setGameVisible(false); setError(null);
    },
    acceptRejoin: () => run('rejoin', async () => {
      const latest = await NativeSharePlay?.getSnapshotAsync();
      if (!latest || !['joined', 'waiting'].includes(latest.status) || latest.sessionId !== rejoinSession.current) {
        setRejoinOffered(false); rejoinSession.current = null; return;
      }
      if (latest.status === 'waiting') await NativeSharePlay?.joinAsync();
      const joined = await NativeSharePlay?.getSnapshotAsync();
      if (!joined || !['joined', 'waiting'].includes(joined.status)) throw new Error('SharePlay: notJoined');
      nativeSessionRef.current = joined;
      manualLobby.current = true; gameActive.current = false;
      try { await sendPresence(true); }
      catch (error) {
        participation.current.exclude(joined.localParticipantId!);
        applySnapshot(joined, true); setOpen(false);
        throw error;
      }
      rejoinSession.current = null; setRejoinOffered(false);
      setOpen(true); setGameVisible(false);
      logSharePlay('rejoin.accepted');
    }),
    playerNames, localPlayerName, playerNameLoaded,
    setLocalPlayerName: (name) => {
      const cleaned = cleanPlayerName(name);
      if (!cleaned) return;
      setLocalPlayerNameState(cleaned);
      void AsyncStorage.setItem(PLAYER_NAME_KEY, cleaned).catch(() => {
        logSharePlay('player-name.save-failed', {}, true);
      });
    },
    game, decks, gameVisible,
    gameActions: {
      ready: () => liveGame.current?.act('ready'),
      start: () => liveGame.current?.act('start'),
      pause: () => liveGame.current?.act('pause'),
      resume: () => liveGame.current?.act('resume'),
      answer: (outcome) => liveGame.current?.act('answer', outcome),
      selectMode: (mode) => liveGame.current?.selectMode(mode),
      selectGuesser: (guesserId) => liveGame.current?.selectGuesser(guesserId),
      selectDeck: (deckId) => liveGame.current?.selectDeck(deckId),
      selectDuration: (seconds) => liveGame.current?.selectDuration(seconds),
      returnToLobby: () => {
        liveGame.current?.returnToLobby();
      },
      nextRound: () => {
        liveGame.current?.nextRound();
      },
      endGame: () => liveGame.current?.endGame(),
    },
    closeGame: () => {
      const phase = liveGame.current?.currentView?.phase;
      // Active rounds are exited through Leave or explicitly paused in the X
      // menu. A presentation callback must not pause everyone else's game.
      if (phase && ['countdown', 'playing', 'feedback'].includes(phase)) return;
      setGameVisible(false); gameActive.current = false; manualLobby.current = true; setOpen(true);
      if (sessionRef.current.isHost) liveGame.current?.returnToLobby();
    },
    open(next) {
      if (!enabled) return;
      setSetup(next); setOpen(true); setSharePlayAudioBlocked(true);
      // Preserve startup failures so an unavailable build has a useful explanation.
      if (initialized) setError(null);
    },
    updateSetupDuration(seconds) {
      setSetup((current) => current ? { ...current, durationSeconds: seconds } : current);
    },
    updateSetupDeck(deckId) {
      const deck = catalog.getDeckById(deckId);
      if (!deck || !canShareDeck(deck, ownedDeckIds)) return;
      setSetup((current) => current ? { ...current, deckId, deckTitle: deck.title,
        access: deck.access === 'paid' ? 'paid' : 'free' } : current);
    },
    close() {
      if (sessionRef.current.sessionId || operation.current) return;
      setOpen(false); setError(null); setSharePlayAudioBlocked(false);
    },
    invite: () => run('invite', async () => {
      if (!NativeSharePlay || !initialized || !setup || !canInvite || !localPlayerName ||
        invitationPending || sessionRef.current.sessionId) return;
      const { access: _access, ...selection } = setup;
      const result = await NativeSharePlay.inviteAsync({ ...selection, protocolVersion: 4, environment, nonce: randomUUID() });
      if (result === 'cancelled') { logSharePlay('invite.cancelled'); return; }
      setInvitationPending(true);
      // A fresh snapshot reconciles an event that arrived while UIKit owned presentation.
      applySnapshot(await NativeSharePlay.getSnapshotAsync());
    }),
    join: () => run('join', async () => {
      await NativeSharePlay?.joinAsync();
      const latest = await NativeSharePlay?.getSnapshotAsync();
      if (latest) nativeSessionRef.current = latest;
      await sendPresence(true);
      setRejoinOffered(false); rejoinSession.current = null;
    }),
    leave: (endForEveryone = false) => run(endForEveryone ? 'end' : 'leave', async () => {
      if (!NativeSharePlay) return;
      // Read Apple's latest roster so leaving after the other players depart
      // ends the activity even if this screen still has an older snapshot.
      const current = await NativeSharePlay.getSnapshotAsync();
      applySnapshot(current);
      const lastPlayer = isLastSharePlayParticipant(sessionRef.current);
      if (endForEveryone || lastPlayer) {
        if (!lastPlayer && !sessionRef.current.isHost) throw new Error('SharePlay: notHost');
        if (lastPlayer) logSharePlay('session.last-player-end', { members: 1 });
        // The installed bridge may still reject a recovered host. Tell every
        // current app participant to leave as well as ending Apple's activity.
        const native = NativeSharePlay;
        await endSharePlaySession({
          notifyParticipants: async () => {
            if (lastPlayer) return;
            if (!liveGame.current) throw new Error('SharePlay: noLiveGame');
            await liveGame.current.endSession();
          },
          endNativeSession: () => native.endAsync(),
          leaveNativeSession: () => native.leaveAsync(),
          onFailure: (stage, error) => logSharePlay(`session.end-${stage}-failed`, { code: String(error) }, true),
        });
      } else await NativeSharePlay.leaveAsync();
      applySnapshot(await NativeSharePlay.getSnapshotAsync());
      rejoinSession.current = null; setRejoinOffered(false);
      await AsyncStorage.removeItem(REJOIN_SESSION_KEY);
      setInvitationPending(false);
      gameActive.current = false; manualLobby.current = false; setGameVisible(false);
      setOpen(false); setError(null); setSharePlayAudioBlocked(false);
    }),
    checkConnection: () => run('check-connection', async () => {
      const current = sessionRef.current;
      if (!NativeSharePlay || current.status !== 'joined' || !probe.current) return;
      const native = NativeSharePlay;
      const checks = current.participantIds.filter((id) => id !== current.localParticipantId).map(async (id) => {
        const body = probe.current?.begin(id, randomUUID(), performance.now());
        if (body) await native.sendAsync(body, [id]);
      });
      setPeers(probe.current.snapshot());
      const results = await Promise.allSettled(checks);
      logSharePlay('connection.check-result', { members: results.length,
        ready: results.filter((result) => result.status === 'fulfilled').length });
      if (results.some((result) => result.status === 'rejected')) {
        setError('Some connection checks could not be sent. Wait for everyone to join, then try again.');
      }
    }),
  };
  useEffect(() => { endGameRef.current = () => { void value.leave(true); }; });
  return <SharePlayContext.Provider value={value}>{children}</SharePlayContext.Provider>;
}

export function useSharePlay() {
  const context = useContext(SharePlayContext);
  if (!context) throw new Error('SharePlayProvider is missing');
  return context;
}
