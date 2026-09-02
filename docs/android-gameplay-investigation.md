# Android gameplay timing and lifecycle

## Findings

### Countdown display

`useRoundTimer` discarded the value returned by `useState` and returned
`getRemainingSeconds(endsAt)` instead. Since `endsAt` stays constant throughout
the countdown, React Compiler could cache the return expression. Timer callbacks
continued to emit 3, 2, 1 while the rendered result stayed at 3.

The hook now returns an explicit state snapshot associated with its deadline.
Cues and expiration run from that committed snapshot. The scheduler still uses
absolute second boundaries; it skips expired beats after a stall and cancels its
timeout on cleanup. It does not accumulate intervals or replay missed beats.

### Sounds replaying together on the next deck

The connected Android device's saved diagnostic trace provides direct evidence:
on September 2, 2026 at 14:00:17.211–17.219 UTC, Get Ready, count-3, count-2,
count-1 and round-start all reported playing during second-round preparation.
The explicit Get Ready playback request did not occur until 14:00:21.692 UTC.

Android's ExoPlayer retains `playWhenReady` after playback ends. At that point
`playing` is false. The previous `if (player.playing) player.pause()` skipped
pause for completed players; preparing them with `seekTo(0)` restarted them all.
This was not evidence of multiple mounted audio providers: the provider lives
above navigation and intentionally reuses the same players.

Preparation now pauses unconditionally before seeking, sets volume beforehand,
and primes each player. A prepared countdown cue plays without another seek at
its second boundary. Preparation happens once after recorder startup instead of
also running in a readiness-driven effect. Completion-driven tick rewinds were
removed. Playback and preparation requests are invalidated when stopped or
superseded, so an old seek continuation cannot call play after cancellation.

### Correct/Pass responsiveness

There was no gesture feedback timeout or animation completion gate in the
current gameplay path. The timed fallback belongs only to manual controls.
The actual delays and races were elsewhere:

- Neutral detection used the same low-pass filtered angle as scoring. After a
  deep tilt, the filter still indicated a tilted phone after the raw measurement
  had returned to center. Android now uses the first raw neutral measurement to
  rearm, and resets the filter at that point. Scoring retains its angle threshold,
  smoothing and two-sample confirmation. Duplicate Android sensor timestamps do
  not count twice toward confirmation.
- Queued sensor events could report an answer and then neutral before React
  committed feedback. The rearm callback could therefore see the old playing
  state and fail to advance. The hook retains that neutral event until the
  feedback callback commits, then advances without a timeout.
- Sound diagnostics queried many native player properties. The installed Expo
  Android implementation executes those getters using `runBlocking` on its main
  queue. Those reads were removed from playback and readiness diagnostics;
  readiness uses existing status events instead.
- Diagnostic persistence synchronously wrote the entire trace to disk every
  250 ms during activity. Writes are now asynchronous and serialized.
- Android Correct feedback ran the vibration motor for 450 ms. Correct now uses
  a short Heavy impact; Pass and card-flip use Medium impacts. See the haptic
  regression investigation below for why View-based gesture effects were removed.

Card state advances before its sound/haptic effects. Sensor calibration no
longer attempts a React state update on every already-calibrated sample.

## Lifecycle ownership

- Ready focus starts a clean sound session. Blur/cancel invalidates startup
  continuations and intro cues; foreground state gates timers and sensors.
- Every async intro stage checks whether it still belongs to the current screen.
- Game sensors remain subscribed through playing/feedback, so rearming retains
  its detector state. They unsubscribe on pause, finish, blur and unmount.
- Finishing stops previous cues before the ending sound. Leaving gameplay stops
  all cues. App backgrounding also invalidates pending playback and haptic series.
- Leaving while camera startup is pending waits for startup and cancellation to
  settle. Configuring another deck waits for cancellation/finalization, including
  the audio-mode reset. Background recording pause joins pending startup too.
- The results hold timeout is cleared on effect cleanup; a late screenshot
  cannot initiate a transition after cleanup.

## iOS comparison

Both platforms share the countdown and round reducer. The correctness fixes to
state and cleanup apply to both. iOS retains the original 50 ms sensor interval,
0.35 filter factor, filtered neutral detection with two samples, native haptic
path, audio-session options and 550 ms manual fallback. Android uses its existing
40 ms cadence and 350 ms manual fallback, with raw neutral detection and short
Vibrator-backed impacts. Neither gesture path waits for a feedback timeout.

## Android haptic regression

Comparison with `f0830c6` shows that the responsiveness changes replaced Android
Correct/Pass/card-flip feedback with Expo's `performAndroidHapticsAsync` using
Confirm, Reject and Gesture_End. The installed Expo native implementation calls
`View.performHapticFeedback`; its successful promise does not establish that the
phone supports the selected effect.

The connected phone's `dumpsys vibrator_manager` records WHATZ IT's requests at
07:41:24–07:41:39 PDT on September 2, 2026 as `ignored_unsupported` for constants
13, 16 and 17. Its saved application trace nevertheless records successful haptic
API completion. This establishes an unsupported-effect regression, rather than
missing gesture events or permanent lifecycle cancellation.

The correction uses Expo's Vibrator-backed impacts: Heavy for Correct and Medium
for Pass/card-flip. Heavy is the installed library's 60 ms impact, avoiding the
old 450 ms Correct vibration. There is one API dispatch per cue, with no speculative
fallback that could cause a duplicate. Game effects remain fire-and-forget and
deduplicated by card index; next-card advancement never waits for haptics.

The final ten seconds also had an explicit Android exclusion in the working tree;
that exclusion is removed. Each committed second again requests one Rigid impact.
The timer's existing once-per-second dispatch remains responsible for deduplication.

Get Ready, initial 3/2/1 and Time's Up were not removed. The phone records the
expected two intro impacts, one/two/three countdown impacts, and the three-pulse
ending waveform as `finished` during the same 07:41 round. These patterns remain
unchanged. This is OS evidence of completed requests, not a measurement of what
the user physically felt.

Cleanup still invalidates pending haptic sequences and cancels vibration when
leaving/backgrounding or clearing a session; it does not disable the haptic API.
Regression tests verify cancellation during a countdown and during an outstanding
native call, followed by working feedback in another round. No audio, sensor,
recording, timer, or iOS haptic implementation changes are part of this correction.

All 183 repository tests, TypeScript and targeted ESLint checks pass after this
correction. The 23 added tests execute the actual haptic module with mocked native
APIs, cover every cue with/without recording, cancellation, nonserialized gesture
cues, and unchanged iOS native dispatch. Physical feel of the corrected app still
requires device testing.

## Verification

- All 160 repository tests passed, including the new compiled-hook countdown
  regression, cancellation/second-game playback tests, and 100 alternating deep
  tilt/neutral cycles.
- TypeScript and targeted ESLint checks passed.
- Android production JavaScript/Hermes export passed with React Compiler enabled.
- The original Android audio failure was confirmed from the device's saved trace.
  The updated app has not been installed or physically gesture-tested here.

On an Android release build, verify two consecutive decks, rapid alternating
Correct/Pass gestures, holding a tilt, cancel during Get Ready, and background/
resume during intro, countdown and feedback. Check with and without recording.
Repeat a short iOS round to confirm its established feel remains intact.
