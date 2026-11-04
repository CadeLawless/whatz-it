import { Host, Switch } from '@expo/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppSheet, type AppSheetRef } from '@/components/app-sheet';
import { CircularCloseButton } from '@/components/circular-close-button';
import { cleanPlayerName } from '@/shareplay/player-names';
import { useSharePlay } from '@/shareplay/session-provider';
import { DEFAULT_VIDEO_PREFERENCES, loadVideoPreferences, saveVideoPreferences, type VideoPreferences } from '@/storage/video-preferences';
import { getFeedbackPreferences, loadFeedbackPreferences, saveFeedbackPreferences, type FeedbackPreferences } from '@/storage/feedback-preferences';
import { colors, radius, spacing, typography } from '@/theme';
import { useRoundCameraPermissions } from '@/video/round-camera-permission';

export default function SettingsScreen() {
  const router = useRouter();
  const sheetRef = useRef<AppSheetRef>(null);
  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      sheetRef.current?.close();
      return true;
    });
    return () => subscription.remove();
  }, []));
  const sharePlay = useSharePlay();
  const { cameraStatus, microphoneStatus, requestCameraAccess, requestMicrophoneAccess } = useRoundCameraPermissions();
  const [preferences, setPreferences] = useState<VideoPreferences>(DEFAULT_VIDEO_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = nameDraft ?? sharePlay.localPlayerName;
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackPreferences>(getFeedbackPreferences);
  const [feedbackLoaded, setFeedbackLoaded] = useState(false);
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackAttempt, setFeedbackAttempt] = useState(0);
  const cameraAllowed = Platform.OS !== 'web' && cameraStatus === 'authorized';
  const microphoneAllowed = Platform.OS !== 'web' && microphoneStatus === 'authorized';

  useEffect(() => {
    let active = true;
    void loadVideoPreferences().then((value) => {
      if (active) { setPreferences(value); setLoaded(true); }
    }).catch(() => { if (active) setError('Your settings could not be loaded. Please try again.'); });
    return () => { active = false; };
  }, [loadAttempt]);
  useEffect(() => {
    let active = true;
    void loadFeedbackPreferences().then((value) => {
      if (active) { setFeedback(value); setFeedbackLoaded(true); }
    }).catch(() => { if (active) setFeedbackError('Sound and haptics settings could not be loaded. Please try again.'); });
    return () => { active = false; };
  }, [feedbackAttempt]);

  const changeFeedback = async (key: keyof FeedbackPreferences, value: boolean) => {
    if (!feedbackLoaded || savingFeedback) return;
    const previous = feedback;
    const next = { ...feedback, [key]: value };
    setFeedback(next); setSavingFeedback(true); setFeedbackError(null);
    try { await saveFeedbackPreferences(next); }
    catch { setFeedback(previous); setFeedbackError('This change could not be saved. Please try again.'); }
    finally { setSavingFeedback(false); }
  };

  const changePreference = async (key: keyof VideoPreferences, value: boolean) => {
    if (!loaded || saving || (key === 'microphone' ? !microphoneAllowed : !cameraAllowed)) return;
    const previous = preferences;
    const next = { ...preferences, [key]: value };
    setPreferences(next); setSaving(true); setError(null);
    try { await saveVideoPreferences(next); }
    catch { setPreferences(previous); setError('This change could not be saved. Please try again.'); }
    finally { setSaving(false); }
  };
  const allowPermission = async (kind: 'camera' | 'microphone') => {
    setRequestingPermissions(true); setError(null);
    try { await (kind === 'camera' ? requestCameraAccess() : requestMicrophoneAccess()); }
    catch { setError('Permissions could not be requested. You can update them in device settings.'); }
    finally { setRequestingPermissions(false); }
  };
  const saveName = async () => {
    if (!cleanPlayerName(name) || savingName) return;
    setSavingName(true); setNameMessage(null);
    const saved = await sharePlay.setLocalPlayerName(name);
    setSavingName(false);
    if (saved) {
      setNameDraft(null);
      setNameMessage('Name saved.'); Keyboard.dismiss();
    } else setNameMessage('Your name could not be saved. Please try again.');
  };

  return <AppSheet accessibilityLabel="Settings" heightFraction={0.92} onClose={close} ref={sheetRef}>
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      <View style={styles.sheetHeader}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>Settings</Text>
        <CircularCloseButton accessibilityLabel="Close Settings" appearance="sheet"
          onPress={() => sheetRef.current?.close()} />
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
    automaticallyAdjustKeyboardInsets style={styles.screen} contentContainerStyle={styles.content}>
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Round videos</Text>
      <Text style={styles.body}>Choose which modes record video on this device. Changes apply to your next round.</Text>
      {!loaded && !error && <ActivityIndicator accessibilityLabel="Loading video settings" color={colors.play} />}
      <View style={styles.card}>
        {(['classic', 'pass-n-play'] as const).map((mode) => <View key={mode} style={styles.switchRow}>
          <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={colors.play} style={styles.switchHost}>
            <Switch label={mode === 'classic' ? 'Classic video capture' : 'Pass n Play video capture'}
              value={cameraAllowed && preferences[mode]} disabled={!loaded || saving || !cameraAllowed}
              onValueChange={(value) => { void changePreference(mode, value); }} />
          </Host>
        </View>)}
        <View style={styles.switchRow}>
          <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={colors.play} style={styles.switchHost}>
            <Switch label="Include microphone audio" value={microphoneAllowed && preferences.microphone}
              disabled={!loaded || saving || !microphoneAllowed}
              onValueChange={(value) => { void changePreference('microphone', value); }} />
          </Host>
          <Text style={styles.caption}>Applies to videos in both modes. Turn it off to record silently.</Text>
        </View>
      </View>
      {(!cameraAllowed || !microphoneAllowed) && <View style={styles.notice}>
        <Text style={styles.body}>{Platform.OS === 'web' ? 'Video recording is available in the mobile app.' :
          !cameraAllowed && !microphoneAllowed ? 'Allow camera access to enable video capture. Microphone access is optional for audio.' :
          !cameraAllowed ? 'Allow camera access to enable video capture.' :
          'Microphone access is off. You can still record silent videos.'}</Text>
        {Platform.OS !== 'web' && <>
          {cameraStatus === 'not-determined' && <Pressable accessibilityRole="button" disabled={requestingPermissions}
            onPress={() => { void allowPermission('camera'); }} style={styles.linkButton}>
            <Text style={styles.link}>ALLOW CAMERA</Text>
          </Pressable>}
          {microphoneStatus === 'not-determined' && <Pressable accessibilityRole="button" disabled={requestingPermissions}
            onPress={() => { void allowPermission('microphone'); }} style={styles.linkButton}>
            <Text style={styles.link}>ALLOW MICROPHONE</Text>
          </Pressable>}
          <Pressable accessibilityRole="button" onPress={() => {
            void Linking.openSettings().catch(() => setError('Device settings could not be opened. Please open them from your home screen.'));
          }} style={styles.linkButton}><Text style={styles.link}>OPEN DEVICE SETTINGS</Text></Pressable>
        </>}
      </View>}
      {error && <View accessibilityLiveRegion="polite">
        <Text style={styles.error}>{error}</Text>
        {!loaded && <Pressable accessibilityRole="button" onPress={() => { setError(null); setLoadAttempt((value) => value + 1); }}
          style={styles.linkButton}><Text style={styles.link}>TRY AGAIN</Text></Pressable>}
      </View>}
    </View>
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Sound & haptics</Text>
      <Text style={styles.body}>Applies to Classic, Pass n Play, and SharePlay on this device.</Text>
      {!feedbackLoaded && !feedbackError && <ActivityIndicator accessibilityLabel="Loading sound and haptics settings" color={colors.play} />}
      <View style={styles.card}>
        {(['sound', 'haptics'] as const).map((key) => <View key={key} style={styles.switchRow}>
          <Host matchContents={{ vertical: true }} colorScheme="light" seedColor={colors.play} style={styles.switchHost}>
            <Switch label={key === 'sound' ? 'Sound effects' : 'Haptics'} value={feedback[key]}
              disabled={!feedbackLoaded || savingFeedback}
              onValueChange={(value) => { void changeFeedback(key, value); }} />
          </Host>
          <Text style={styles.caption}>{key === 'sound' ? 'Countdowns, card feedback, and round sounds.' : 'Vibration feedback during rounds.'}</Text>
        </View>)}
      </View>
      {feedbackError && <View accessibilityLiveRegion="polite">
        <Text style={styles.error}>{feedbackError}</Text>
        {!feedbackLoaded && <Pressable accessibilityRole="button" onPress={() => {
          setFeedbackError(null); setFeedbackAttempt((value) => value + 1);
        }} style={styles.linkButton}><Text style={styles.link}>TRY AGAIN</Text></Pressable>}
      </View>}
    </View>
    {Platform.OS === 'ios' && <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>SharePlay</Text>
      <Text style={styles.body}>The name your friends see in the SharePlay lobby.</Text>
      <View style={[styles.card, styles.nameCard]}>
        <Text style={styles.noticeTitle}>Your name</Text>
        <TextInput accessibilityLabel="Your SharePlay name" autoCapitalize="words" autoCorrect={false}
          editable={sharePlay.playerNameLoaded && !savingName} maxLength={32} value={name}
          onChangeText={(value) => { setNameDraft(value); setNameMessage(null); }}
          onSubmitEditing={() => { void saveName(); }} placeholder="Enter your name" placeholderTextColor={colors.muted}
          returnKeyType="done" style={styles.nameInput} />
        <Pressable accessibilityRole="button" disabled={!sharePlay.playerNameLoaded || !cleanPlayerName(name) || savingName || cleanPlayerName(name) === sharePlay.localPlayerName}
          onPress={() => { void saveName(); }} style={({ pressed }) => [styles.saveButton,
            (!sharePlay.playerNameLoaded || !cleanPlayerName(name) || savingName || cleanPlayerName(name) === sharePlay.localPlayerName) && styles.disabled,
            pressed && styles.pressed]}>
          <Text style={styles.saveText}>{savingName ? 'SAVING…' : 'SAVE NAME'}</Text>
        </Pressable>
        {nameMessage && <Text accessibilityLiveRegion="polite" style={styles.body}>{nameMessage}</Text>}
      </View>
    </View>}
      </ScrollView>
    </SafeAreaView>
  </AppSheet>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  sheetTitle: { ...typography.title, color: colors.ink, flex: 1 },
  content: { padding: spacing.lg, gap: spacing.xl, paddingBottom: spacing.xxl,
    width: '100%', maxWidth: 720, alignSelf: 'center' },
  section: { gap: spacing.md },
  heading: { ...typography.body, fontSize: 20, lineHeight: 26,
    fontFamily: 'Inter_700Bold', fontWeight: '700', color: colors.ink },
  body: { ...typography.body, fontSize: 15, lineHeight: 22, color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  switchRow: { paddingHorizontal: spacing.md, paddingVertical: spacing.md + spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border, gap: spacing.sm },
  switchHost: { width: '100%', minHeight: 44, flexShrink: 0 },
  caption: { ...typography.body, fontSize: 13, lineHeight: 19, color: colors.muted },
  notice: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.playPale, gap: spacing.sm },
  noticeTitle: { ...typography.body, fontFamily: 'Inter_700Bold', color: colors.ink },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  link: { ...typography.body, fontSize: 14, color: colors.play, fontFamily: 'Inter_700Bold' },
  error: { ...typography.body, fontSize: 14, color: colors.passText },
  nameCard: { padding: spacing.md, gap: spacing.md },
  nameInput: { ...typography.body, color: colors.ink, minHeight: 52, padding: spacing.md,
    backgroundColor: colors.background, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  saveButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, backgroundColor: colors.play },
  saveText: { ...typography.body, color: colors.white, fontFamily: 'Inter_800ExtraBold' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
