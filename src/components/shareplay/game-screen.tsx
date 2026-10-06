import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCatalog } from '@/catalog/catalog-provider';
import { CloseButton } from '@/components/close-button';
import { PortraitAnswerText, PortraitRoundFeedback } from '@/components/portrait-round-visuals';
import { PortraitTimesUpPanel } from '@/components/portrait-times-up-panel';
import { formatRoundClock } from '@/game/round-duration';
import { canShowSharePlayRoundOptions } from '@/shareplay/presentation';
import { useSharePlay } from '@/shareplay/session-provider';
import { useSharePlayReadyFeedback } from '@/shareplay/use-ready-feedback';
import { useSharePlayRoundCues } from '@/shareplay/use-round-cues';
import { colors, radius, spacing, typography } from '@/theme';
import { SharePlayReadyCounter } from './ready-counter';

function Action({ label, disabled, secondary = false, lightBlue = false, onPress, equalWidth = false }: {
  label: string; disabled?: boolean; secondary?: boolean; lightBlue?: boolean;
  onPress: () => void; equalWidth?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton,
      lightBlue && styles.lightBlueButton, equalWidth && styles.equalButton,
      disabled && styles.disabled, pressed && styles.pressed]}>
    <Text style={[styles.buttonText, secondary && styles.secondaryButtonText,
      lightBlue && styles.lightBlueButtonText,
      equalWidth && styles.answerButtonText]}>{label}</Text>
  </Pressable>;
}

export function SharePlayGameScreen() {
  const [confirmRoundId, setConfirmRoundId] = useState<string | null>(null);
  const [choosePlayerRoundId, setChoosePlayerRoundId] = useState<string | null>(null);
  const [dismissedTimeUpRoundId, setDismissedTimeUpRoundId] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const { catalog } = useCatalog();
  const sharePlay = useSharePlay();
  const readyUp = useSharePlayReadyFeedback();
  const { view, remainingMs, countdown } = sharePlay.game;
  const localId = sharePlay.session.localParticipantId;
  useSharePlayRoundCues(view, countdown, remainingMs, localId, sharePlay.gameVisible);
  const isTurnOwner = !!localId && view?.guesserId === localId;
  const passNPlay = view?.mode === 'pass-n-play';
  const isGuesser = !!view && (passNPlay ? !isTurnOwner : isTurnOwner);
  const isClueGiver = !!view && !isGuesser;
  const guesserName = view?.guesserId === localId ? sharePlay.localPlayerName :
    sharePlay.playerNames[view?.guesserId ?? ''];
  const deckId = view?.deck.deckId ?? sharePlay.decks.selectedDeckId ?? sharePlay.session.activity?.deckId;
  const deckTitle = (deckId ? catalog.getDeckById(deckId)?.title : null) ??
    sharePlay.session.activity?.deckTitle ?? 'SharePlay';
  const close = () => {
    if (view && ['countdown', 'playing', 'feedback', 'paused'].includes(view.phase)) setConfirmRoundId(view.roundId);
    else sharePlay.closeGame();
  };
  const clock = formatRoundClock(Math.ceil(remainingMs / 1000));
  const results = view?.phase === 'results' || view?.phase === 'ended';
  const canShowOptions = canShowSharePlayRoundOptions(view?.phase);
  if (confirmRoundId && (!canShowOptions || !sharePlay.gameVisible || confirmRoundId !== view?.roundId)) {
    setConfirmRoundId(null);
  }
  const showTimeUp = view?.phase === 'results' && view.resultReason === 'time' &&
    dismissedTimeUpRoundId !== view.roundId;
  useEffect(() => {
    if (view?.phase !== 'results' || view.resultReason !== 'time') return;
    const timeout = setTimeout(() => setDismissedTimeUpRoundId(view.roundId), 2495);
    return () => clearTimeout(timeout);
  }, [view?.phase, view?.resultReason, view?.roundId]);

  if (!sharePlay.gameVisible) return null;
  return <SafeAreaView edges={[]} style={[styles.screen, results && !showTimeUp && styles.resultsScreen,
      showTimeUp && styles.timeUpScreen, view?.phase === 'feedback' ? styles.feedbackScreen :
        !showTimeUp && { paddingTop: Math.max(insets.top, spacing.md), paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <StatusBar hidden />
      {view?.phase === 'feedback' ?
        <PortraitRoundFeedback outcome={view.feedback === 'correct' ? 'correct' : 'pass'} /> :
        showTimeUp ? <PortraitTimesUpPanel /> :
        <View style={[styles.panel, view?.phase === 'countdown' && styles.countdownPanel,
          results && styles.resultsPanel]}>
          {!results && <View style={styles.header}>
            <CloseButton accessibilityLabel="Round options" onPress={close} />
          </View>}

          {!view && <View style={styles.content}>
            <Text accessibilityRole="header" style={styles.title}>CONNECTING</Text>
            <Text style={styles.message}>Connecting to the shared round…</Text>
          </View>}

          {view?.phase === 'countdown' && <View style={styles.countdownContent}>
            <Text accessibilityRole="header" style={styles.countdownTitle}>GET READY</Text>
            <Text accessibilityLiveRegion="polite" style={styles.countdownNumber}>
              {Math.max(1, countdown)}
            </Text>
          </View>}

          {view?.phase === 'playing' && <>
            <View style={styles.cardArea}>
              <View style={styles.content}>
                <Text style={styles.clock}>{clock}</Text>
                {isGuesser ? <>
                  <Text accessibilityRole="header" style={styles.title}>YOUR TURN TO GUESS</Text>
                  <Text style={styles.message}>{passNPlay ?
                    `Listen to ${guesserName || 'the clue giver'}’s clues.` : 'Listen to your friends’ clues.'}</Text>
                </> : isClueGiver && view.card ? <>
                  <PortraitAnswerText key={view.card.answer} text={view.card.answer} />
                  {!!view.card.byline && <Text style={styles.byline}>{view.card.byline}</Text>}
                  <Text style={styles.clueInstruction}>
                    {passNPlay ? 'Try to get your friends to guess this answer.' :
                      `Try to get ${guesserName || 'the guesser'} to guess this answer.`}
                  </Text>
                </> : <Text style={styles.message}>Waiting for the next card…</Text>}
              </View>
            </View>
            <View style={styles.footer}>
              {isTurnOwner && <View style={styles.answerActions}>
                <Action label="PASS" secondary equalWidth disabled={!view.canAnswer}
                  onPress={() => sharePlay.gameActions.answer('pass')} />
                <Action label="CORRECT" equalWidth disabled={!view.canAnswer}
                  onPress={() => sharePlay.gameActions.answer('correct')} />
              </View>}
            </View>
          </>}

          {view?.phase === 'paused' && <>
            <View style={styles.cardArea}>
              <View style={styles.content}>
                <Text style={styles.clock}>{clock}</Text>
                <Text accessibilityRole="header" style={styles.title}>ROUND PAUSED</Text>
                <Text style={styles.message}>The round will resume when everyone is ready.</Text>
              </View>
            </View>
            <View style={styles.footer}>
              <SharePlayReadyCounter view={view} />
              {!view.ready.includes(localId ?? '') &&
                <Action label="I’M READY" onPress={readyUp} />}
            </View>
          </>}

          {results && <>
            <ScrollView style={styles.resultsScroll} contentContainerStyle={styles.resultsContent}>
              <Text style={styles.resultsEyebrow}>SHAREPLAY ROUND RESULTS</Text>
              <Text accessibilityRole="header" style={styles.resultsTitle}>Nice guessing!</Text>
              <Text style={styles.resultsDeck}>{deckTitle}</Text>
              <View style={styles.scoreRow}>
                <View style={[styles.scoreCard, { backgroundColor: colors.correct }]}>
                  <Text style={styles.scoreNumber}>{view.score}</Text>
                  <Text style={styles.scoreLabel}>CORRECT</Text>
                </View>
                <View style={[styles.scoreCard, { backgroundColor: colors.pass }]}>
                  <Text style={styles.scoreNumber}>{view.results?.filter((item) => item.outcome === 'pass').length ?? 0}</Text>
                  <Text style={styles.scoreLabel}>PASSED</Text>
                </View>
              </View>
              <Text style={styles.listLabel}>YOUR CARDS</Text>
              {view.results?.map((item, index) => <View key={`${index}-${item.answer}`} style={styles.resultRow}>
                <View style={[styles.outcomeDot, { backgroundColor: item.outcome === 'correct' ? colors.correct :
                  item.outcome === 'pass' ? colors.pass : colors.muted }]}>
                  <Text style={styles.outcomeIcon}>{item.outcome === 'correct' ? '✓' : item.outcome === 'pass' ? '×' : '–'}</Text>
                </View>
                <Text style={styles.resultText}>{item.answer}</Text>
                <Text style={styles.outcomeLabel}>{item.outcome === 'correct' ? 'CORRECT' :
                  item.outcome === 'pass' ? 'PASSED' : 'UNANSWERED'}</Text>
              </View>)}
              {!view.results?.length && <Text style={styles.message}>Time ran out before a card was answered.</Text>}
            </ScrollView>
            <View style={[styles.footer, styles.resultsFooter]}>
              {view.phase === 'results' && <Text style={styles.nextPlayer}>
                {passNPlay ? 'NEXT STARTING PLAYER' : 'NEXT GUESSER'}: {isTurnOwner ? 'YOU' :
                  guesserName ?? 'CONNECTING…'}
              </Text>}
              {isTurnOwner && view.phase === 'results' ?
                <Action label="PLAY AGAIN" disabled={sharePlay.session.participantIds.length < 2 ||
                  sharePlay.decks.selectedDeckId !== view.deck.deckId}
                  onPress={sharePlay.gameActions.nextRound} /> :
                <Action label="BACK TO LOBBY" onPress={sharePlay.closeGame} />}
              {isTurnOwner && view.phase === 'results' &&
                <Action label={passNPlay ? 'MAKE SOMEONE ELSE STARTING PLAYER' : 'MAKE SOMEONE ELSE GUESSER'}
                  secondary onPress={() => setChoosePlayerRoundId(view.roundId)} />}
              {isTurnOwner && view.phase === 'results' &&
                <Action label="BACK TO LOBBY" secondary onPress={sharePlay.gameActions.returnToLobby} />}
            </View>
          </>}

          {view?.phase === 'lobby' && <View style={styles.content}>
            <Text accessibilityRole="header" style={styles.title}>ROUND READY</Text>
            <Text style={styles.message}>Return to the Lobby to choose players and start.</Text>
            <Action label="BACK TO LOBBY" onPress={sharePlay.closeGame} />
          </View>}
          {view && ['countdown', 'playing', 'paused'].includes(view.phase) &&
            <Text numberOfLines={2} style={styles.deckTitleBottom}>{deckTitle}</Text>}
        </View>}

      {canShowOptions && confirmRoundId && confirmRoundId === view?.roundId && <View accessibilityViewIsModal
        style={styles.promptOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss round options"
          onPress={() => setConfirmRoundId(null)} style={StyleSheet.absoluteFill} />
        <View style={styles.promptCard}>
          <Text accessibilityRole="header" style={styles.promptTitle}>ROUND OPTIONS</Text>
          <Text style={styles.promptBody}>What would you like to do?</Text>
          <View style={styles.promptActions}>
            <Action label="KEEP PLAYING" secondary onPress={() => setConfirmRoundId(null)} />
            {view?.phase !== 'paused' && <Action label="PAUSE" lightBlue onPress={() => {
              setConfirmRoundId(null); sharePlay.gameActions.pause();
            }} />}
            <Action label={isTurnOwner ? 'BACK TO LOBBY' : 'LEAVE'} onPress={() => {
              setConfirmRoundId(null);
              if (isTurnOwner) sharePlay.gameActions.returnToLobby();
              else void sharePlay.leave();
            }} />
          </View>
        </View>
      </View>}
      {view?.phase === 'results' && isTurnOwner && choosePlayerRoundId === view.roundId &&
        <View accessibilityViewIsModal style={styles.promptOverlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close player picker"
            onPress={() => setChoosePlayerRoundId(null)} style={StyleSheet.absoluteFill} />
          <View style={styles.promptCard}>
            <Text accessibilityRole="header" style={styles.promptTitle}>
              {passNPlay ? 'CHOOSE A STARTING PLAYER' : 'CHOOSE A GUESSER'}
            </Text>
            <ScrollView style={styles.playerPicker} contentContainerStyle={styles.promptActions}>
              {view.participants.filter((id) => id !== localId).map((id) =>
                <Action key={id} label={sharePlay.playerNames[id] ?? 'Choosing a name…'} onPress={() => {
                  sharePlay.gameActions.selectGuesser(id); setChoosePlayerRoundId(null);
                }} />)}
            </ScrollView>
          </View>
        </View>}
    </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.md, backgroundColor: colors.playSoft },
  resultsScreen: { backgroundColor: colors.background },
  timeUpScreen: { backgroundColor: colors.surface },
  feedbackScreen: { padding: 0 },
  panel: { flex: 1, minHeight: 0, borderWidth: 6, borderColor: colors.roundBorder,
    borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden' },
  countdownPanel: { backgroundColor: colors.surface },
  resultsPanel: { borderWidth: 0, borderRadius: 0, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  deckTitleBottom: { ...typography.body, color: colors.muted, textAlign: 'center',
    textTransform: 'uppercase', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  cardArea: { flex: 1, minHeight: 0 },
  clock: { ...typography.title, color: colors.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  title: { ...typography.hero, color: colors.play, textAlign: 'center' },
  message: { ...typography.body, color: colors.muted, textAlign: 'center' },
  clueInstruction: { ...typography.body, fontSize: 14, lineHeight: 20,
    color: colors.muted, textAlign: 'center', paddingHorizontal: spacing.sm },
  byline: { ...typography.body, fontSize: 21, lineHeight: 28,
    fontFamily: 'Inter_700Bold', color: colors.muted, textAlign: 'center' },
  countdownContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  countdownTitle: { ...typography.hero, color: colors.play, textAlign: 'center' },
  countdownNumber: { fontSize: 128, lineHeight: 145, fontFamily: 'Inter_900Black',
    color: colors.play, textAlign: 'center', fontVariant: ['tabular-nums'] },
  footer: { padding: spacing.md, gap: spacing.sm },
  resultsFooter: { paddingHorizontal: spacing.lg, borderTopWidth: 1,
    borderTopColor: colors.border, backgroundColor: colors.background },
  nextPlayer: { ...typography.body, color: colors.play, fontFamily: 'Inter_900Black', textAlign: 'center' },
  playerPicker: { maxHeight: 360 },
  answerActions: { flexDirection: 'row', gap: spacing.md },
  button: { minHeight: 56, padding: spacing.md, borderRadius: radius.lg,
    justifyContent: 'center', alignItems: 'center', backgroundColor: colors.play },
  secondaryButton: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  lightBlueButton: { backgroundColor: colors.playSoft },
  equalButton: { flex: 1, minHeight: 80 },
  buttonText: { ...typography.body, fontFamily: 'Inter_900Black', color: colors.white, textAlign: 'center' },
  secondaryButtonText: { color: colors.ink },
  lightBlueButtonText: { color: colors.play },
  answerButtonText: { fontSize: 22, lineHeight: 28 },
  resultsScroll: { flex: 1 },
  resultsContent: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  resultsEyebrow: { color: colors.muted, fontSize: 12, fontFamily: 'Inter_900Black', letterSpacing: 1.8 },
  resultsTitle: { ...typography.hero, color: colors.ink },
  resultsDeck: { color: colors.muted, fontSize: 16, fontFamily: 'Inter_700Bold' },
  scoreRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  scoreCard: { flex: 1, borderRadius: radius.xl, padding: spacing.lg },
  scoreNumber: { color: colors.ink, fontSize: 52, lineHeight: 58, fontFamily: 'Inter_900Black' },
  scoreLabel: { color: colors.ink, fontSize: 11, fontFamily: 'Inter_900Black', letterSpacing: 1.3 },
  listLabel: { color: colors.muted, fontSize: 12, fontFamily: 'Inter_900Black', letterSpacing: 1.7,
    marginTop: spacing.xl, marginBottom: spacing.sm },
  resultRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  outcomeDot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  outcomeIcon: { color: colors.ink, fontSize: 17, fontFamily: 'Inter_900Black' },
  resultText: { ...typography.body, flex: 1, color: colors.ink, fontFamily: 'Inter_800ExtraBold' },
  outcomeLabel: { color: colors.muted, fontSize: 9, fontFamily: 'Inter_900Black', letterSpacing: 1 },
  promptOverlay: { ...StyleSheet.absoluteFill, zIndex: 100, backgroundColor: 'rgba(24,35,29,0.42)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  promptCard: { width: '100%', maxWidth: 440, padding: spacing.xl,
    borderRadius: radius.xl, backgroundColor: colors.background },
  promptTitle: { ...typography.title, color: colors.ink, textAlign: 'center' },
  promptBody: { ...typography.body, color: colors.muted, textAlign: 'center', marginTop: spacing.sm },
  promptActions: { gap: spacing.sm, marginTop: spacing.xl },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
