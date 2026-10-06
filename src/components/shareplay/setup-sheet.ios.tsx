import { catalogLocalCoverSources } from '@/catalog/catalog-media';
import { useCatalog } from '@/catalog/catalog-provider';
import { CircularCloseButton } from '@/components/circular-close-button';
import { ConfirmationPrompt } from '@/components/confirmation-prompt';
import { GameModeSelector } from '@/components/game-mode-selector';
import { formatDuration, TimerPicker } from '@/components/timer-picker';
import { useRound } from '@/game/round-context';
import { canShareDeck } from '@/shareplay/deck-access';
import { SHAREPLAY_RUNTIME_REVISION, sharePlayTraceText } from '@/shareplay/diagnostics';
import { cleanPlayerName } from '@/shareplay/player-names';
import { sharePlaySurface } from '@/shareplay/presentation';
import { useSharePlay } from '@/shareplay/session-provider';
import { useSharePlayReadyFeedback } from '@/shareplay/use-ready-feedback';
import { useOwnedDeckIds } from '@/storefront/commerce-provider';
import { colors, radius, spacing } from '@/theme';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { SharePlayGameScreen } from './game-screen';
import { SharePlayRolePickerSheet } from './role-picker-sheet';
import { SharePlayRejoinPrompt } from './rejoin-prompt';

function Button({ label, onPress, disabled, secondary, danger, arrow }: {
  label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean; arrow?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, (secondary || danger) && styles.secondary,
      disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryText, danger && styles.dangerText]}>{label}</Text>
    {arrow && <Text style={styles.arrow}>→</Text>}
  </Pressable>;
}

export function SharePlaySetupSheet() {
  const [confirmation, setConfirmation] = useState<'leave' | 'end' | null>(null);
  const [inviteHelpOpen, setInviteHelpOpen] = useState(false);
  const [debugTrace, setDebugTrace] = useState<string | null>(null);
  const [deckSearchOpen, setDeckSearchOpen] = useState(false);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);
  const [deckSheetHeight, setDeckSheetHeight] = useState(0);
  const [deckSearch, setDeckSearch] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const nameScroll = useRef<ScrollView>(null);
  const editNameScroll = useRef<ScrollView>(null);
  const editNameInput = useRef<TextInput>(null);
  const sharePlay = useSharePlay();
  // This persistent owner observes resets for lobby and round screens once.
  const readyUp = useSharePlayReadyFeedback();
  const { catalog } = useCatalog();
  const ownedDeckIds = useOwnedDeckIds();
  const { round, isRecording, isVideoFinalizing } = useRound();
  const { height, width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const backdropOpacity = useSharedValue(0);
  const sheetTranslateY = useSharedValue(1200);
  const deckTranslateY = useSharedValue(1200);
  const deckBackdropOpacity = useSharedValue(0);
  const nameTranslateY = useSharedValue(1200);
  const nameBackdropOpacity = useSharedValue(0);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.get() }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetTranslateY.get() }] }));
  const deckSheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: deckTranslateY.get() }] }));
  const deckBackdropStyle = useAnimatedStyle(() => ({ opacity: deckBackdropOpacity.get() }));
  const nameSheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: nameTranslateY.get() }] }));
  const nameBackdropStyle = useAnimatedStyle(() => ({ opacity: nameBackdropOpacity.get() }));
  const insets = useSafeAreaInsets();
  const { session, setup, peers, busy } = sharePlay;
  const joined = session.status === 'joined';
  // Reanimated retains animated properties when an animated style is removed.
  // Use a different native view for the lobby so a sheet offset cannot survive rejoin.
  const MainContainer = joined ? View : Animated.View;
  const nameStep = !sharePlay.playerNameLoaded || !sharePlay.localPlayerName;
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (event) => setKeyboardHeight(event.endCoordinates.height));
    const change = Keyboard.addListener('keyboardWillChangeFrame', (event) =>
      setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => { show.remove(); change.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    if (nameStep && keyboardHeight > 0) requestAnimationFrame(() => nameScroll.current?.scrollToEnd({ animated: true }));
  }, [keyboardHeight, nameStep]);
  useEffect(() => {
    if (editingName && keyboardHeight > 0)
      requestAnimationFrame(() => editNameScroll.current?.scrollToEnd({ animated: true }));
  }, [editingName, keyboardHeight]);
  const hasSession = !!session.sessionId;
  const reportedController = sharePlay.decks.controllerId;
  const controllerCandidate = sharePlay.game.view?.phase === 'lobby' ? sharePlay.game.view.guesserId :
    reportedController && session.participantIds.includes(reportedController) ? reportedController : session.hostParticipantId;
  const controllerReady = !!controllerCandidate && session.participantIds.includes(controllerCandidate);
  const surface = sharePlaySurface({ enabled: sharePlay.enabled, joined, setupOpen: sharePlay.isOpen,
    localAvailable: ['idle', 'finished'].includes(round.status) && !isRecording && !isVideoFinalizing,
    gameVisible: sharePlay.gameVisible, phase: sharePlay.heldResultsView?.phase ?? sharePlay.game.view?.phase,
    rejoinOffered: sharePlay.rejoinOffered, controllerReady });
  const visible = surface !== null;
  const [previousSurface, setPreviousSurface] = useState(surface);
  if (previousSurface !== surface) {
    setPreviousSurface(surface);
    if (surface === 'round' || surface === null) {
      setConfirmation(null); setInviteHelpOpen(false); setDeckSearchOpen(false);
      setHostPickerOpen(false); setEditingName(false);
    }
  }
  useEffect(() => {
    if (surface !== 'round' && surface !== null) return;
    Keyboard.dismiss();
  }, [surface]);
  useEffect(() => {
    if (editingName && visible) requestAnimationFrame(() => editNameInput.current?.focus());
  }, [editingName, visible]);
  useEffect(() => {
    if (visible) {
      backdropOpacity.set(0);
      sheetTranslateY.set(reduceMotion ? 0 : 1200);
      backdropOpacity.set(withTiming(1, { duration: reduceMotion ? 100 : 220 }));
      sheetTranslateY.set(withTiming(0, { duration: reduceMotion ? 0 : 320 }));
    } else {
      backdropOpacity.set(0);
      sheetTranslateY.set(1200);
      deckTranslateY.set(1200);
      deckBackdropOpacity.set(0);
      nameTranslateY.set(1200);
      nameBackdropOpacity.set(0);
    }
  }, [backdropOpacity, deckBackdropOpacity, deckTranslateY,
    nameBackdropOpacity, nameTranslateY, reduceMotion, sheetTranslateY, visible]);
  useEffect(() => {
    if (!visible) return;
    deckTranslateY.set(withTiming(deckSearchOpen ? 0 : 1200, { duration: reduceMotion ? 0 : 300 }));
    deckBackdropOpacity.set(withTiming(deckSearchOpen ? 1 : 0, { duration: reduceMotion ? 0 : 220 }));
  }, [deckBackdropOpacity, deckSearchOpen, deckTranslateY, reduceMotion, visible]);
  useEffect(() => {
    if (!visible) return;
    nameTranslateY.set(withTiming(editingName ? 0 : 1200, { duration: reduceMotion ? 0 : 300 }));
    nameBackdropOpacity.set(withTiming(editingName ? 1 : 0, { duration: reduceMotion ? 0 : 220 }));
  }, [editingName, nameBackdropOpacity, nameTranslateY, reduceMotion, visible]);
  const lobby = sharePlay.game.view?.phase === 'lobby' ? sharePlay.game.view : null;
  const controllerId = controllerReady ? controllerCandidate : null;
  const passNPlay = sharePlay.decks.mode === 'pass-n-play';
  const selectedRole = passNPlay ? 'starting player' : 'guesser';
  const originalSelection = session.activity ?? setup;
  const selectedDeckId = sharePlay.decks.selectedDeckId;
  const deckId = hasSession ? selectedDeckId : originalSelection?.deckId;
  const deck = deckId ? catalog.getDeckById(deckId) : undefined;
  const cover = deck ? catalogLocalCoverSources(deck)[0] : undefined;
  const deckTitle = deck?.title ?? (deckId ? originalSelection?.deckTitle : null) ?? 'Choose a deck';
  const isController = joined && !!controllerId && controllerId === session.localParticipantId;
  const canChooseDeck = !hasSession || isController;
  const durationSeconds = hasSession ? sharePlay.decks.durationSeconds : originalSelection?.durationSeconds ?? 60;
  const playerLabel = (id: string) => {
    const name = id === session.localParticipantId ? sharePlay.localPlayerName : sharePlay.playerNames[id];
    return name ? `${name}${id === session.localParticipantId ? ' (you)' : ''}` : 'Choosing a name…';
  };
  const allPlayersNamed = joined && session.participantIds.every((id) => id === session.localParticipantId ?
    !!sharePlay.localPlayerName : !!sharePlay.playerNames[id]);
  const controllerName = controllerId === session.localParticipantId ? sharePlay.localPlayerName :
    controllerId ? sharePlay.playerNames[controllerId] : null;
  const closeNameEdit = useCallback(() => {
    Keyboard.dismiss();
    setNameDraft(sharePlay.localPlayerName);
    setEditingName(false);
  }, [sharePlay.localPlayerName]);
  const close = useCallback(() => {
    if (busy) return;
    if (inviteHelpOpen) { setInviteHelpOpen(false); return; }
    if (hostPickerOpen) { setHostPickerOpen(false); return; }
    if (editingName) { closeNameEdit(); return; }
    if (deckSearchOpen) { setDeckSearchOpen(false); setDeckSearch(''); return; }
    if (!hasSession) { sharePlay.close(); return; }
    setConfirmation('leave');
  }, [busy, closeNameEdit, deckSearchOpen, editingName, hasSession, hostPickerOpen,
    inviteHelpOpen, sharePlay]);
  const closeDeckSearch = useCallback(() => {
    Keyboard.dismiss(); setDeckSearchOpen(false); setDeckSearch('');
  }, []);
  const lobbyDrag = useMemo(() => Gesture.Pan().activeOffsetY([-8, 8]).failOffsetX([-28, 28])
    .onUpdate(({ translationY }) => { sheetTranslateY.set(Math.max(0, translationY)); })
    .onEnd(({ translationY, velocityY }) => {
      if (translationY >= 72 || velocityY >= 720) scheduleOnRN(close);
      sheetTranslateY.set(reduceMotion ? 0 : withSpring(0, { duration: 400, dampingRatio: 1 }));
    }), [close, reduceMotion, sheetTranslateY]);
  const deckDrag = useMemo(() => Gesture.Pan().activeOffsetY([-8, 8]).failOffsetX([-28, 28])
    .onUpdate(({ translationY }) => { deckTranslateY.set(Math.max(0, translationY)); })
    .onEnd(({ translationY, velocityY }) => {
      if (translationY >= 72 || velocityY >= 720) scheduleOnRN(closeDeckSearch);
      else deckTranslateY.set(reduceMotion ? 0 : withSpring(0, { duration: 400, dampingRatio: 1 }));
    }), [closeDeckSearch, deckTranslateY, reduceMotion]);
  const nameDrag = useMemo(() => Gesture.Pan().activeOffsetY([-8, 8]).failOffsetX([-28, 28])
    .onUpdate(({ translationY }) => { nameTranslateY.set(Math.max(0, translationY)); })
    .onEnd(({ translationY, velocityY }) => {
      if (translationY >= 72 || velocityY >= 720) scheduleOnRN(closeNameEdit);
      else nameTranslateY.set(reduceMotion ? 0 : withSpring(0, { duration: 400, dampingRatio: 1 }));
    }), [closeNameEdit, nameTranslateY, reduceMotion]);
  const availableDeckIds = new Set(hasSession ? sharePlay.decks.availableDeckIds :
    catalog.decks.filter((item) => canShareDeck(item, ownedDeckIds)).map((item) => item.id));
  const searchQuery = deckSearch.trim().toLowerCase();
  const searchableDecks = catalog.decks.filter((item) =>
    availableDeckIds.has(item.id) && item.title.toLowerCase().includes(searchQuery))
    .sort((a, b) => a.title.localeCompare(b.title));
  const gridGap = 12;
  const gridWidth = Math.max(64, Math.floor((width - spacing.lg * 2 - gridGap * 2) / 3));
  const openDeckSearch = () => {
    setDeckSheetHeight(Math.max(200, Math.min(height * 0.88, height - insets.top - 20)));
    setDeckSearchOpen(true);
  };
  const chooseDeck = (id: string) => {
    if (!canChooseDeck || !availableDeckIds.has(id)) return;
    if (hasSession) sharePlay.gameActions.selectDeck(id);
    else sharePlay.updateSetupDeck(id);
    closeDeckSearch();
  };
  const submitName = () => {
    const name = cleanPlayerName(nameDraft);
    if (!name) return;
    Keyboard.dismiss();
    sharePlay.setLocalPlayerName(name);
    setEditingName(false);
  };
  return <Modal transparent presentationStyle="overFullScreen"
    animationType="none" visible={visible} onRequestClose={() => {
      if (surface === 'rejoin') { if (!busy) sharePlay.declineRejoin(); }
      else close();
    }} statusBarTranslucent>
    {surface === 'rejoin' ? <SharePlayRejoinPrompt /> : surface === 'round' ? <SharePlayGameScreen /> :
    surface === 'connecting' ? <View style={[styles.overlay, styles.lobbyOverlay, styles.content]}>
      <Text style={styles.title}>Connecting to players…</Text>
      <Text style={styles.body}>Preparing the shared lobby and assigning a starting player.</Text>
      <Button label="LEAVE" secondary disabled={busy} onPress={() => { void sharePlay.leave(); }} />
    </View> :
    <View style={[styles.overlay, joined && styles.lobbyOverlay, { paddingBottom: nameStep ? keyboardHeight : 0 }]}>
      {joined && <StatusBar style="dark" />}
      {!joined && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop,
        backdropStyle]} />}
      {!joined && <Pressable onPress={close} accessibilityLabel="Close SharePlay sheet" style={StyleSheet.absoluteFill} />}
      <MainContainer accessibilityViewIsModal importantForAccessibility={deckSearchOpen || editingName || hostPickerOpen ? 'no-hide-descendants' : 'auto'}
        style={[styles.sheet, !joined && { maxHeight: Math.max(200, height - (nameStep ? keyboardHeight : 0) - insets.top - 12) },
        { paddingBottom: Math.max(insets.bottom, 12) }, joined ? [styles.lobbyScreen,
          { paddingTop: Math.max(insets.top, spacing.md) }] : sheetStyle]}>
        {!joined && <GestureDetector gesture={lobbyDrag}>
          <View accessibilityElementsHidden style={styles.grabberArea}><View style={styles.grabber} /></View>
        </GestureDetector>}
        {nameStep ? <ScrollView ref={nameScroll} keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => { if (keyboardHeight > 0) nameScroll.current?.scrollToEnd({ animated: true }); }}
          style={[styles.mainScroll, joined && styles.lobbyScroll]}
          contentContainerStyle={styles.content}>
          <View style={styles.titleRow}>
            <SymbolView name="shareplay" size={28} tintColor={colors.play} accessibilityElementsHidden />
            <Text style={styles.title}>Your name</Text>
            {!joined && <CircularCloseButton accessibilityLabel="Close SharePlay" appearance="sheet" onPress={close} />}
          </View>
          <Text style={styles.body}>{sharePlay.playerNameLoaded ?
            'Enter the name your friends will see in the SharePlay Lobby.' : 'Loading your saved name…'}</Text>
          {sharePlay.playerNameLoaded && <TextInput accessibilityLabel="Your SharePlay name" autoCapitalize="words"
            autoCorrect={false} autoFocus
            maxLength={32} onChangeText={setNameDraft} onSubmitEditing={submitName}
            placeholder="Your name" placeholderTextColor={colors.muted} returnKeyType="done"
            style={styles.nameInput} value={nameDraft} />}
        </ScrollView> : <ScrollView keyboardShouldPersistTaps="handled" style={[styles.mainScroll, joined && styles.lobbyScroll]}
          contentContainerStyle={styles.content}>
          <View style={styles.titleRow}>
            <SymbolView name="shareplay" size={28} tintColor={colors.play} accessibilityElementsHidden />
            <Text style={styles.title}>{hasSession ? 'SharePlay Lobby' : 'SharePlay'}</Text>
            {!joined && <CircularCloseButton accessibilityLabel="Close SharePlay" appearance="sheet" onPress={close} />}
          </View>
          <Text style={styles.body}>{hasSession ? 'Keep FaceTime open while your friends join.' :
            'Guess with friends over FaceTime, wherever they are. Everyone joins on their own iPhone with WHATZ IT?'}</Text>
          {isController && <View style={styles.hostSection}>
            <Text style={styles.label}>{passNPlay ? 'STARTING PLAYER' : 'GUESSER'}</Text>
            <Text style={styles.hostName}>{controllerName ?? 'Connecting…'}{isController ? ' (you)' : ''}</Text>
            {isController && session.participantIds.length > 1 &&
              <Pressable accessibilityRole="button" onPress={() => setHostPickerOpen(true)}
                style={({ pressed }) => [styles.changeHostButton, pressed && styles.pressed]}>
                <Text style={styles.changeHostText}>SWITCH {passNPlay ? 'STARTING PLAYER' : 'GUESSER'}</Text>
              </Pressable>}
          </View>}
          {originalSelection && <Pressable accessibilityRole={canChooseDeck ? 'button' : undefined}
            accessibilityLabel={canChooseDeck ? `Choose a deck, currently ${deckTitle}` : deckTitle}
            disabled={!canChooseDeck} onPress={openDeckSearch} style={({ pressed }) =>
              [styles.deckCard, pressed && canChooseDeck && styles.pressed]}>
            {cover ? <Image source={cover} contentFit="cover" style={styles.cover} /> :
              <View style={[styles.cover, styles.coverFallback]}><Text style={styles.coverIcon}>▣</Text></View>}
            <View style={styles.deckDetails}>
              <Text style={styles.deckTitle}>{deckTitle}</Text>
              {hasSession && !isController && <>
                <View style={styles.deckMetadataRow}>
                  <SymbolView name="die.face.5.fill" size={15} tintColor={colors.muted} accessibilityElementsHidden />
                  <Text style={styles.deckMetadataText}>{passNPlay ? "Pass n' Play" : 'Classic'}</Text>
                </View>
                <View style={styles.deckMetadataRow}>
                  <SymbolView name="stopwatch.fill" size={15} tintColor={colors.muted} accessibilityElementsHidden />
                  <Text style={styles.deckMetadataText}>{formatDuration(durationSeconds)}</Text>
                </View>
              </>}
              {canChooseDeck && <Text style={styles.status}>TAP TO CHANGE DECK</Text>}
            </View>
            {canChooseDeck && <Text style={styles.deckChevron}>›</Text>}
          </Pressable>}
          {(!hasSession || isController) && <View style={styles.group}>
            <Text style={styles.label}>GAME MODE</Text>
            <GameModeSelector sharePlay value={hasSession ? sharePlay.decks.mode : sharePlay.setupMode}
              disabled={busy || (hasSession && !!sharePlay.game.view && sharePlay.game.view.phase !== 'lobby')}
              onChange={hasSession ? sharePlay.gameActions.selectMode : sharePlay.updateSetupMode} />
          </View>}
          {originalSelection && (!hasSession || isController) && <View style={styles.group}>
            <Text style={styles.label}>ROUND LENGTH</Text>
            {(!hasSession || isController) ?
              <TimerPicker value={durationSeconds} onChange={(seconds) => {
                if (hasSession) sharePlay.gameActions.selectDuration(seconds);
                else sharePlay.updateSetupDuration(seconds);
              }} /> : <Text style={styles.body}>{formatDuration(durationSeconds)}</Text>}
          </View>}
          {!sharePlay.available && <Text style={styles.muted}>Install the latest SharePlay development build to invite friends.</Text>}
          {!hasSession && !sharePlay.canInvite && <Text style={styles.muted}>Choose a deck to invite friends.</Text>}
          {!hasSession && sharePlay.invitationPending && <Text style={styles.muted}>
            Invite sent. Tap Start/Open in the FaceTime call to join the SharePlay Lobby.
          </Text>}
          {joined && !lobby && <Text style={styles.muted}>{session.participantIds.length < 2
            ? 'Waiting for another player to join. A new round will appear when they rejoin.' : !selectedDeckId
              ? isController ? 'Choose an available deck to get ready.' : `Waiting for the ${selectedRole} to choose a deck.` : isController &&
              !sharePlay.decks.availableDeckIds.includes(selectedDeckId)
              ? 'Waiting for someone who owns this deck…' :
                'Connecting to the other players and preparing the shared deck…'}</Text>}
          {joined && <View style={styles.group}>
            <View style={styles.playersHeading}>
              <Text style={styles.label}>PLAYERS</Text>
              {joined && <Pressable accessibilityRole="button"
                accessibilityLabel="How to add people to SharePlay"
                onPress={() => setInviteHelpOpen(true)} style={({ pressed }) =>
                  [styles.addPeopleButton, pressed && styles.pressed]}>
                <Text style={styles.addPeopleText}>+ ADD PEOPLE</Text>
              </Pressable>}
            </View>
            {session.participantIds.map((id) => {
              const isGuesser = id === controllerId;
              const connected = id === session.localParticipantId || peers[id] === 'confirmed';
              return <View key={id} style={styles.playerConnectionRow}>
                <View accessible accessibilityLabel={`${playerLabel(id)}, ${connected ? 'connected' : 'not connected'}`}
                  style={styles.playerConnectionIcon}>
                  <SymbolView name="wifi" size={24} weight="bold" type="monochrome"
                    tintColor={connected ? colors.connectionGreen : colors.connectionGray}
                    accessibilityElementsHidden />
                  {!connected && <View style={styles.connectionSlash} />}
                </View>
                <View style={[styles.playerRow, isGuesser && styles.guesserRow]}>
                <View style={styles.playerIdentity}>
                  {isGuesser && <Text style={styles.guesserLabel}>{passNPlay ? 'STARTING PLAYER' : 'GUESSER'}</Text>}
                  <Text style={styles.playerName}>
                    {playerLabel(id)}
                    {id === session.localParticipantId && <Text accessibilityRole="button"
                      accessibilityLabel="Edit your SharePlay name"
                      suppressHighlighting
                      onPress={(event) => {
                        event.stopPropagation();
                        setNameDraft(sharePlay.localPlayerName); setEditingName(true);
                      }}>
                      {'\u00A0'}
                      <Image source={require('../../../assets/icons/edit-pencil.svg')} contentFit="contain"
                        style={styles.editNameIcon} />
                    </Text>}
                  </Text>
                </View>
                <Text style={[styles.playerState, lobby?.ready.includes(id) && styles.readyState]}>
                  {lobby?.resultsViewingIds?.includes(id) ? 'IN RESULTS' :
                    lobby?.ready.includes(id) ? 'READY' : 'WAITING'}</Text>
                </View>
              </View>;
            })}
            {!allPlayersNamed && <Text style={styles.muted}>Waiting for everyone to enter a name…</Text>}
          </View>}
          {sharePlay.error && <Text style={styles.error}>{sharePlay.error}</Text>}
          {__DEV__ && <View style={styles.debugCard}>
            <Text style={styles.debugText}>SharePlay code: {SHAREPLAY_RUNTIME_REVISION}</Text>
            <Pressable accessibilityRole="button" onPress={() => setDebugTrace(debugTrace === null ? sharePlayTraceText() : null)}>
              <Text style={styles.debugToggle}>{debugTrace === null ? 'SHOW SHAREPLAY DEBUG LOG' : 'HIDE SHAREPLAY DEBUG LOG'}</Text>
            </Pressable>
            {debugTrace !== null && <>
              <Text style={styles.muted}>Recent events on this iPhone. Tap Refresh after testing. Select the text to copy it.</Text>
              <Pressable accessibilityRole="button" onPress={() => setDebugTrace(sharePlayTraceText())}>
                <Text style={styles.debugToggle}>REFRESH LOG</Text>
              </Pressable>
              <Text selectable style={styles.debugText}>{debugTrace}</Text>
            </>}
          </View>}
          {!hasSession && <Button label="INVITE FRIENDS" arrow disabled={busy || !sharePlay.available ||
            !sharePlay.initialized || !sharePlay.canInvite || sharePlay.invitationPending}
            onPress={() => { void sharePlay.invite(); }} />}
          {session.status === 'waiting' && <Button label="JOIN SESSION" arrow disabled={busy}
            onPress={() => { void sharePlay.join(); }} />}
        </ScrollView>}
        {!deckSearchOpen && nameStep && <View style={styles.lobbyFooter}>
          {sharePlay.playerNameLoaded && <Button label="CONTINUE" arrow disabled={!cleanPlayerName(nameDraft)} onPress={submitName} />}
          {hasSession && <Button label="LEAVE" secondary disabled={busy} onPress={close} />}
        </View>}
        {!deckSearchOpen && !nameStep && hasSession && <View style={styles.lobbyFooter}>
          {joined && lobby && (!lobby.ready.includes(session.localParticipantId ?? '') ?
            <Button label="I’M READY" arrow disabled={busy} onPress={readyUp} /> :
            <Button label="YOU’RE READY" disabled onPress={() => undefined} />)}
          <View style={styles.footerRow}>
            <View style={styles.footerAction}><Button label="LEAVE" secondary disabled={busy} onPress={close} /></View>
          {isController && session.participantIds.length > 1 && <View style={styles.footerAction}>
              <Button label="END GAME" danger disabled={busy} onPress={() => setConfirmation('end')} />
            </View>}
          </View>
        </View>}
      </MainContainer>
      <Animated.View pointerEvents={deckSearchOpen ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.deckBackdrop, deckBackdropStyle]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to SharePlay Lobby"
          onPress={closeDeckSearch} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View pointerEvents={deckSearchOpen ? 'auto' : 'none'} accessibilityViewIsModal
        importantForAccessibility={deckSearchOpen ? 'auto' : 'no-hide-descendants'}
        style={[styles.sheet, styles.deckSheet,
          { height: deckSheetHeight || Math.max(200, Math.min(height * 0.88, height - insets.top - 20)),
            paddingBottom: Math.max(insets.bottom, 12) }, deckSheetStyle]}>
        <GestureDetector gesture={deckDrag}>
          <View accessibilityElementsHidden style={styles.grabberArea}><View style={styles.grabber} /></View>
        </GestureDetector>
        <View style={styles.searchSheet}>
          <View style={styles.titleRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to SharePlay Lobby"
              onPress={closeDeckSearch} style={({ pressed }) => [styles.roleBack, pressed && styles.pressed]}>
              <SymbolView name="chevron.left" size={20} tintColor={colors.play} accessibilityElementsHidden />
            </Pressable>
            <Text style={styles.title}>Choose a deck</Text>
            <CircularCloseButton accessibilityLabel="Close deck picker" appearance="sheet" onPress={closeDeckSearch} />
          </View>
          <Text style={styles.body}>{hasSession ? 'Choose a deck owned by anyone in this SharePlay session.' :
            'Choose one of your available decks.'}</Text>
          <View style={styles.searchField}>
            <Text accessibilityElementsHidden style={styles.searchIcon}>⌕</Text>
            <TextInput accessibilityLabel="Search SharePlay decks" autoCapitalize="none" autoCorrect={false}
              onChangeText={setDeckSearch} placeholder="Search decks" placeholderTextColor={colors.muted}
              returnKeyType="search" style={styles.searchInput} value={deckSearch} />
            {deckSearch.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Clear deck search"
              onPress={() => setDeckSearch('')}><Text style={styles.searchClear}>×</Text></Pressable>}
          </View>
          <ScrollView alwaysBounceVertical keyboardDismissMode="on-drag" keyboardShouldPersistTaps="always"
            style={[styles.searchList, { marginBottom: keyboardHeight }]}
            contentContainerStyle={[styles.searchResults, { columnGap: gridGap, rowGap: gridGap }]}>
            {searchableDecks.map((item) => {
              const itemCover = catalogLocalCoverSources(item)[0];
              return <Pressable key={item.id} accessibilityRole="button"
                accessibilityLabel={`${item.title}${deckId === item.id ? ', selected' : ''}`}
                accessibilityState={{ selected: deckId === item.id }}
                onPress={() => chooseDeck(item.id)} style={({ pressed }) =>
                  [styles.searchResult, { width: gridWidth, height: gridWidth * 1.5 }, pressed && styles.pressed]}>
                {itemCover ? <Image source={itemCover} contentFit="cover" style={styles.resultCover} /> :
                  <View style={[styles.resultCover, styles.coverFallback]}><Text style={styles.coverIcon}>▣</Text></View>}
                {deckId === item.id && <View pointerEvents="none" style={styles.selectedCover}>
                  <Text style={styles.selectedPill}>SELECTED</Text>
                </View>}
              </Pressable>;
            })}
            {searchableDecks.length === 0 && <Text style={styles.muted}>{searchQuery ?
              'No available decks match your search.' : 'No decks are available yet.'}</Text>}
          </ScrollView>
        </View>
      </Animated.View>
      <Animated.View pointerEvents={editingName ? 'auto' : 'none'}
        style={[StyleSheet.absoluteFill, styles.deckBackdrop, nameBackdropStyle]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to SharePlay Lobby"
          onPress={closeNameEdit} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View pointerEvents={editingName ? 'auto' : 'none'} accessibilityViewIsModal
        importantForAccessibility={editingName ? 'auto' : 'no-hide-descendants'}
        style={[styles.sheet, styles.nameEditSheet,
          { bottom: keyboardHeight,
            maxHeight: Math.max(240, height - keyboardHeight - insets.top - 12),
            paddingBottom: keyboardHeight > 0 ? 12 : Math.max(insets.bottom, 12) }, nameSheetStyle]}>
        <GestureDetector gesture={nameDrag}>
          <View accessibilityElementsHidden style={styles.grabberArea}><View style={styles.grabber} /></View>
        </GestureDetector>
        <ScrollView ref={editNameScroll} keyboardShouldPersistTaps="handled" style={styles.mainScroll}
          onContentSizeChange={() => {
            if (editingName && keyboardHeight > 0) editNameScroll.current?.scrollToEnd({ animated: true });
          }} contentContainerStyle={styles.content}>
          <View style={styles.titleRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to SharePlay Lobby"
              onPress={closeNameEdit} style={({ pressed }) => [styles.roleBack, pressed && styles.pressed]}>
              <SymbolView name="chevron.left" size={20} tintColor={colors.play} accessibilityElementsHidden />
            </Pressable>
            <Text style={styles.title}>Your name</Text>
            <CircularCloseButton accessibilityLabel="Close name editor" appearance="sheet" onPress={closeNameEdit} />
          </View>
          <Text style={styles.body}>Enter the name your friends will see in the SharePlay Lobby.</Text>
          <TextInput accessibilityLabel="Your SharePlay name" autoCapitalize="words" autoCorrect={false}
            maxLength={32} onChangeText={setNameDraft} onSubmitEditing={submitName}
            placeholder="Your name" placeholderTextColor={colors.muted} ref={editNameInput} returnKeyType="done"
            style={styles.nameInput} value={nameDraft} />
        </ScrollView>
        <View style={styles.lobbyFooter}>
          <Button label="SAVE NAME" arrow disabled={!cleanPlayerName(nameDraft)} onPress={submitName} />
        </View>
      </Animated.View>
      <SharePlayRolePickerSheet visible={hostPickerOpen} mode={sharePlay.decks.mode}
        participants={session.participantIds} localId={session.localParticipantId}
        playerNames={sharePlay.playerNames} localPlayerName={sharePlay.localPlayerName}
        disabled={busy || !isController} onClose={() => setHostPickerOpen(false)}
        onSelect={(id) => { sharePlay.gameActions.selectGuesser(id); setHostPickerOpen(false); }} />
      <ConfirmationPrompt embedded visible={confirmation !== null}
        title={confirmation === 'end' ? 'End Game?' : 'Leave Lobby?'}
        message={confirmation === 'end' ? 'This ends the shared game for every player.' :
          'You can stay in the Lobby or leave this SharePlay game.'}
        cancelLabel={confirmation === 'end' ? 'CANCEL' : 'STAY'}
        confirmLabel={confirmation === 'end' ? 'END GAME' : 'LEAVE'}
        destructive busy={busy} onCancel={() => setConfirmation(null)}
        onConfirm={() => { const end = confirmation === 'end' && session.participantIds.length > 1;
          setConfirmation(null);
          if (end) sharePlay.gameActions.endGame();
          else void sharePlay.leave(); }} />
      <ConfirmationPrompt embedded visible={inviteHelpOpen}
        title="Add People"
        message="To add players to the game, add people to your FaceTime call directly"
        cancelLabel={null} confirmLabel="GOT IT"
        onCancel={() => setInviteHelpOpen(false)} onConfirm={() => setInviteHelpOpen(false)} />
    </View>}
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  lobbyOverlay: { backgroundColor: colors.background, justifyContent: 'flex-start' },
  lobbyScreen: { flex: 1, minHeight: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 },
  backdrop: { backgroundColor: 'rgba(15, 23, 42, 0.36)' },
  deckBackdrop: { backgroundColor: 'rgba(15, 23, 42, 0.18)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  deckSheet: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  nameEditSheet: { position: 'absolute', left: 0, right: 0 },
  grabberArea: { height: 28, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 38, height: 5, borderRadius: 3, backgroundColor: '#8E8E93' },
  mainScroll: { flexShrink: 1 },
  lobbyScroll: { flex: 1, minHeight: 0 },
  content: { paddingHorizontal: spacing.lg, paddingTop: 14, paddingBottom: 20, gap: spacing.md },
  searchSheet: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  lobbyFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background },
  footerRow: { flexDirection: 'row', gap: spacing.sm },
  footerAction: { flex: 1, minWidth: 0 },
  searchField: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16,
    borderWidth: 2, borderColor: colors.playBorder, borderRadius: radius.lg, backgroundColor: colors.surface },
  searchIcon: { color: colors.play, fontSize: 27 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  nameInput: { minHeight: 76, paddingHorizontal: 20, color: colors.ink, fontSize: 20,
    fontFamily: 'Inter_700Bold', borderWidth: 2, borderColor: colors.playBorder,
    borderRadius: radius.lg, backgroundColor: colors.surface },
  roleBack: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  searchClear: { color: colors.muted, fontSize: 28 },
  searchResults: { paddingBottom: 24, flexDirection: 'row', flexWrap: 'wrap' },
  searchList: { flex: 1 },
  searchResult: { borderRadius: 7, overflow: 'hidden', backgroundColor: colors.play },
  resultCover: { width: '100%', height: '100%' },
  selectedCover: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'flex-end',
    paddingBottom: 12, backgroundColor: 'rgba(24, 35, 29, 0.28)' },
  selectedPill: { overflow: 'hidden', paddingHorizontal: 11, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: colors.white, color: colors.play,
    fontSize: 11, fontFamily: 'Inter_900Black' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  title: { flex: 1, fontSize: 27, lineHeight: 32, fontFamily: 'Inter_900Black', color: colors.play },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23, fontFamily: 'Inter_500Medium' },
  deckCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: radius.lg,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  hostSection: { gap: 5, padding: 14, borderRadius: radius.lg, backgroundColor: colors.playPale },
  hostName: { color: colors.play, fontSize: 18, fontFamily: 'Inter_800ExtraBold' },
  changeHostButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 14,
    marginTop: 4, borderRadius: radius.md, backgroundColor: colors.playSoft },
  changeHostText: { color: colors.play, fontSize: 12, fontFamily: 'Inter_900Black' },
  cover: { width: 72, height: 108, borderRadius: 7 },
  coverFallback: { backgroundColor: colors.playSoft, alignItems: 'center', justifyContent: 'center' },
  coverIcon: { fontSize: 28, color: colors.play },
  deckDetails: { flex: 1, gap: 5 },
  deckMetadataRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deckMetadataText: { flexShrink: 1, color: colors.muted, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_600SemiBold' },
  deckChevron: { color: colors.play, fontSize: 30, fontFamily: 'Inter_900Black' },
  deckTitle: { fontSize: 20, fontFamily: 'Inter_800ExtraBold', color: colors.ink },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_600SemiBold' },
  status: { color: colors.play, fontSize: 15, fontFamily: 'Inter_800ExtraBold' },
  label: { color: colors.ink, fontSize: 14, letterSpacing: 0.6, fontFamily: 'Inter_900Black' },
  group: { gap: 9 },
  playerConnectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  playerConnectionIcon: { width: 28, height: 30, alignItems: 'center', justifyContent: 'center' },
  connectionSlash: { position: 'absolute', width: 3, height: 30, borderRadius: 2,
    backgroundColor: colors.connectionGray, transform: [{ rotate: '45deg' }] },
  playerRow: { flex: 1, minWidth: 0, minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md,
    borderWidth: 2, borderColor: 'transparent', backgroundColor: colors.surface },
  guesserRow: { borderColor: colors.play },
  playerIdentity: { flex: 1, gap: 2 },
  editNameIcon: { width: 17, height: 17 },
  guesserLabel: { color: colors.play, fontSize: 11, letterSpacing: 0.5, fontFamily: 'Inter_900Black' },
  guesserHint: { color: colors.muted, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  playersHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addPeopleButton: { minHeight: 44, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  addPeopleText: { color: colors.play, fontSize: 13, fontFamily: 'Inter_900Black' },
  playerName: { flexShrink: 1, color: colors.ink, fontSize: 16, fontFamily: 'Inter_700Bold' },
  playerState: { color: colors.muted, fontSize: 12, fontFamily: 'Inter_900Black' },
  playerHostLabel: { color: colors.play, fontSize: 12, fontFamily: 'Inter_900Black' },
  readyState: { color: colors.connectionGreen },
  error: { color: '#B42318', fontSize: 15, lineHeight: 21, fontFamily: 'Inter_700Bold' },
  debugCard: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.surface, gap: 10 },
  debugToggle: { color: colors.play, fontSize: 13, fontFamily: 'Inter_900Black' },
  debugText: { color: colors.ink, fontSize: 11, lineHeight: 16, fontFamily: 'Inter_500Medium' },
  button: { minHeight: 66, paddingHorizontal: 20, borderRadius: radius.xl, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 14, backgroundColor: colors.pass },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.white, fontSize: 19, fontFamily: 'Inter_900Black', textAlign: 'center' },
  secondaryText: { color: colors.play },
  dangerText: { color: '#B42318' },
  arrow: { color: colors.white, fontSize: 27, fontFamily: 'Inter_900Black' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.78 },
});
