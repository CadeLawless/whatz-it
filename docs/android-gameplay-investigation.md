# Android gameplay timing and lifecycle

## September 11 physical-device acceptance

The player tested the refined Android build and reports significantly improved
responsiveness and that all vibrations are now noticeable. Correct, Pass, card
flip and final countdown ticks feel essentially identical on this Samsung. The
player accepts this tradeoff and prioritizes preserving responsiveness and
reliability over matching iOS haptic differentiation.

Keep the tested gameplay and haptic implementation unchanged. The existing
patterns already differ in duration/rhythm, but this motor lacks amplitude
control. Also, immediate return-to-center feedback can replace the remainder of
an answer waveform, shortening the distinction during fast play. This is a
code-supported explanation, not a measured motor-onset result. Preserving a
complete answer rhythm would require delaying/reordering flip feedback or
extending motor activity; neither is justified by the accepted experience.
No further haptic tuning or iOS changes were made for this feedback.

The saved version-12 trace contains eight accepted gestures (smaller and not a
controlled match to the 70-gesture baseline). Median delivered raw crossing to
acceptance is 19.47 ms, versus 135.86 ms baseline; maximum is 50.04 ms. Median
sensor-to-JS delivery is 21.52 ms (p95 32.48 ms, maximum 144.82 ms), so occasional
delivery outliers remain. Median acceptance-to-layout-effect is 22.10 ms, next JS
frame 44.88 ms, haptic dispatch return 26.12 ms, audio request 26.27 ms and audio
play return 59.73 ms. These remain software-stage proxies, not physical onset
measurements. The evidence supports the recognition change without establishing
a rendering-speed improvement. Artifacts: ignored
`dist/android-latency/device-refined.json` and `refined-summary.json`.

## September 10 device investigation (latest behavior)

The Samsung SM-S166V (Android API 36) reports no amplitude control, supported
effects or primitives. Its vibrator history marks short 20–43 ms waveforms
completed, but the player cannot feel them. Completion is not evidence of feel.

The original installed build was debuggable. A side-by-side release-variant
diagnostic app uses an optimized Hermes bundle while retaining the debuggable
flag solely for pulling its private trace. The original application and its data
remain installed. The baseline diagnostic still used the filtered trigger and
short haptics. With recording on, the player reported substantially improved
Correct/Pass responsiveness but unchanged haptic problems. This distinguishes
the build-configuration improvement from the detector correction below; it does
not isolate every source of the original build's delay.

Baseline recording round: 70 accepted gestures, 3,010 native samples and 2,290 JS
receipts. Native/JS clock alignment uncertainty was 0.15 ms.

| Stage | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| Sensor timestamp → native observer | 5.26 ms | 10.31 ms | 19.66 ms |
| Sensor timestamp → JS receipt | 21.08 ms | 33.40 ms | 56.08 ms |
| First delivered raw trigger crossing → accepted | 135.86 ms | 167.00 ms | 168.83 ms |
| First candidate sample → accepted | 67.05 ms | 84.47 ms | 98.37 ms |
| Accepted → React layout effect | 17.11 ms | 25.18 ms | 31.69 ms |
| Accepted → next JS animation frame | 48.06 ms | 64.97 ms | 80.93 ms |
| Accepted → audio request | 18.13 ms | 26.13 ms | 32.67 ms |
| Accepted → audio play returned | 54.68 ms | 77.62 ms | 152.76 ms |
| Accepted → haptic request | 24.31 ms | 42.50 ms | 58.35 ms |
| Accepted → haptic dispatch returned | 28.26 ms | 50.20 ms | 62.21 ms |

Answer callback and reducer dispatch usually take under 1 ms after acceptance
(maximum 1.28 ms to dispatch). Raw crossing and candidate durations use delivered
JS samples, not a continuous physical-angle recording. Layout
effect and JS animation frame are proxies, not physical display onset; audio and
haptic API return times likewise do not measure speaker or motor onset. The
dedicated native observer measures sensor delivery separately from Expo's
display-frame forwarding. These measurements do not justify a native detector
rewrite at this stage.

The installed Expo Audio implementation uses `runBlocking(mainQueue)` in play
and pause: calling an async wrapper without awaiting it can still block JS before
its first suspension. Android feedback now requests haptics before audio. Android
answers dispatch state before recording-overlay work; the committed feedback
effect records the overlay with the current timer deadline. iOS ordering remains
unchanged.

The filtered trigger plus two samples and 40 ms dwell has a reproducible late
acceptance: at 16 ms intervals, raw angles `[0,.3,.7,1.2,1.2,1.2,1.2,1.2,0,0]`
accept Correct at 128 ms, when raw angle is already zero. Android now uses two
distinct raw samples beyond the same ±0.48 rad trigger, with no extra dwell.
Calibration remains smoothed and time-scaled, neutral remains ±0.30 rad with one
raw sample, and requested delivery remains 16 ms. Tests cover outward acceptance
for fast/deep/shallow/slow gestures in both directions, single-sample spikes,
rapid alternating cards, and unchanged iOS detection.

Motors without amplitude control now receive 90 ms flip pulses, two 90 ms Pass
pulses separated by 90 ms, two 110 ms Get Ready pulses separated by 90 ms,
one/two/three 100 ms initial-countdown pulses separated by 80 ms, and 100 ms final
ticks. Correct remains 180 ms and Time's Up remains three 450 ms pulses. Motors
with amplitude control retain shorter impact patterns. Each cue is one native
waveform; no individual pulse depends on a JS timer. A single pending final tick
follows overlapping gameplay feedback after a 40 ms motor gap, including replay
when an answer interrupted that tick. New-round cues, Time's Up and cleanup clear
pending ticks. Gameplay state never waits for this scheduling.

Diagnostics require both a debuggable Android app and the explicit private file
`files/android-gameplay-diagnostics.enabled`. Trace samples stay in bounded
memory and serialize after input stops, to `files/android-gameplay-latency.json`.
Analyze a pulled trace with
`npx tsx scripts/analyze-android-gameplay-trace.ts <trace.json>`.
Baseline artifacts are in ignored `dist/android-latency/`. The refined diagnostic
build's physical pulse feel and responsiveness were subsequently accepted by
the player on September 11, as recorded above. A refined trace comparison is
separate from that physical assessment.
The refined release-variant APK installed successfully as diagnostic version 12;
206 tests, TypeScript, targeted lint and native Android release compilation passed.

## September 10 initial refinement (superseded settings)

The sections below this update describe earlier fixes already in the repository.
This pass preserves those fixes and changes only Android behavior. No Swift,
shared reducer behavior, iOS cue ordering, or iOS thresholds were changed.

### Findings and event flow

- Haptics: installed Expo 57.0.2 maps Medium and Rigid to exactly the same
  43 ms / amplitude 50 waveform. Heavy is only 60 ms / amplitude 70; Light is
  50 ms / amplitude 30. A motor without amplitude control loses much of even
  that distinction. The iOS reference uses a system vibration for Correct,
  Medium for Pass/flip/Get Ready, Light for 3/2/1 and Rigid for final ticks.
  Android used JS-delayed individual impacts for Get Ready and 3/2/1, and starting
  another cue did not invalidate those future impacts. An old pulse or a final
  countdown tick could replace more meaningful answer feedback.
- Motion: Android uses TYPE_ROTATION_VECTOR through SensorManager's orientation
  calculation; iOS uses CoreMotion attitude.roll. Both feed `-gamma` in radians
  into the portrait-locked, clockwise-rotated canvas. Native screen orientation
  is deliberately not used as a landscape input gate. Existing angle unwrapping
  handles the roll branch discontinuity. Acceleration/gravity validates startup
  samples and forehead placement; it does not determine Correct versus Pass.
- Delivery: Android's DeviceMotion dispatch checks elapsed time on display
  frames. A requested 40 ms interval typically delivers every third 60 Hz frame
  (~50 ms). That can entirely skip a short neutral crossing, leaving the detector
  disarmed despite an intentional next gesture. This is a code-supported likely
  contributor, not a measured diagnosis of the user's missed gestures.
- Accepted tilt -> `answerCard` queues the recording overlay, then dispatches
  ANSWER -> React commits the already-mounted feedback overlay's opacity/color
  -> passive effects request audio and haptics without awaiting either. Android's
  recording append queues work on its encoder executor; it does not wait for
  encoding. There is no gesture animation or timeout gating this visual change.
- Raw neutral -> detector rearms and resets its filter -> `advanceCard` dispatches
  ADVANCE -> next card commits -> its flip feedback runs -> the hook permits the
  next answer. Existing pending-rearm handling retains a center event received
  before feedback commits. A very fast action/neutral batch can commit before a
  separate display frame is painted; no artificial minimum overlay hold was added.
- First audio plays use prepared players. Replays pause and seek asynchronously,
  then play. This can lag haptics; previously a late seek could even start an answer
  after neutral had advanced to a different card. New Android predicates cancel
  that obsolete playback. They do not stop a cue that already started, or queue it
  for later. Audio session activation, playback cancellation, player ownership,
  volumes, the 350 ms manual fallback and the 2495 ms ending hold are unchanged.

### Changes and exact settings

Android now requests 16 ms motion updates. Delivery remains dependent on display,
sensor and JS scheduling. No per-sample React state updates were added. Scoring
retains the +/-0.48 rad (~27.5 degree) trigger, +/-0.30 rad (~17.2 degree) neutral
zone, and at least two distinct samples. Confirmation additionally requires
40 ms of observed candidate time; faster callbacks cannot weaken debouncing.
Smoothing uses `1 - 0.65^(dt / 50)` and baseline adjustment uses
`1 - 0.985^(dt / 50)`, preserving their old approximate time response. Sample
time contributions are capped at 50 ms so a stalled delivery does not become a
large unobserved filter jump. Fallback calibration requires 800 ms as well as
16 samples, and its movement tolerance scales with sample duration. Android's
existing one-raw-sample neutral reset is retained. Duplicate, nonfinite and
out-of-order timestamps are rejected; the timestamp resets on each subscription.
An accepted gesture's existing diagnostic now includes its sample interval.

Android haptics use one native, non-repeating VibrationEffect waveform per cue,
with capability-aware amplitudes and no JS pulse timers. Synchronous native
dispatch preserves call/cancel order; the OS drives the motor independently.
VibratorManager is used on Android 12+, legacy Vibrator below it, and pre-26
devices use the duration pattern. Existing binaries without the new native
method also receive a single duration-only React Native waveform.

| Cue | Pulse durations | Pulse onset spacing | Amplitude (1-255) |
| --- | --- | --- | --- |
| Correct | 180 ms | Single | 220 |
| Pass | 43 ms | Single | 150 |
| Card flip | 20 ms | Single | 90 |
| Get Ready | 2 x 43 ms | 80 ms | 150 |
| Initial 3 / 2 / 1 | 1 / 2 / 3 x 20 ms | 80 ms | 90 |
| Final countdown | 30 ms | Single | 180 |
| Time's Up | 3 x 450 ms | 520 ms | 220 |

The 80 ms intro and 520 ms ending onsets match the iOS scheduler. Correct's
180 ms pulse is an initial tuning choice to distinguish it clearly from Pass
without reinstating the former 450 ms gameplay burst; it is not a measured
equivalent of Apple's system vibration. Pass remains 43 ms; flip becomes shorter.
Motors without amplitude control use the default strength but retain durations
and pulse counts. Every new state cue replaces the previous waveform. A final
clock tick is skipped while any existing round waveform is active, avoiding
truncation. Leaving/cancelling still stops vibration, with additional native
background/destruction cancellation. There are no native delayed pulse callbacks
or playback queues to survive into another round.

### Validation and limits

- Full repository suite: 189 tests passed, including 100 alternating deep tilts,
  elapsed-time filtering, fast neutral/opposite gestures, transient rejection,
  calibration duration, every haptic cue with/without recording, cleanup, older
  binary fallback, iOS native dispatch and stale answer audio cancellation.
- TypeScript passed; targeted ESLint passed with one existing unused import
  warning in game-reducer.test.ts. Android module compileDebugKotlin passed.
- Android production Hermes export also passed with React Compiler enabled.
- The user connected a Samsung SM-S166V during validation (Android API 36).
  `dumpsys vibrator_manager` reports capabilitiesFlags=0, no supported effects
  and no supported primitives. This confirms the absence of amplitude control
  on this phone and the need to distinguish cues by duration/pulse count.
  Sensorservice lists accelerometer, gyroscope, gravity and rotation-vector
  sensors; the rotation vector supports up to 100 Hz and reports no batching.
  Display modes include 60 and 90 Hz. These are capability observations, not
  measurements of delivered gameplay sample intervals or end-to-end latency.
- The installed app remains version 1.1.0/build 8, installed September 4; it was
  not replaced. Updated gameplay and physical haptic feel have not been tested
  on the phone. These checks establish program behavior and compilation, not
  motor strength, display latency or audible onset.
- Full amplitude control requires a rebuilt Android binary. No dependency update,
  iOS native rebuild, store submission or OTA publication was performed.

Test a release build on the actual Android phone, first without recording and
then with recording: 3/2/1 pulse counts; Correct versus Pass versus flip; quick
Correct-center-Pass and the reverse; shallow intentional tilts around 28 degrees;
deep held tilts (one answer only); a rapid center crossing; the final ten seconds
while scoring; cancel mid-countdown; pause/background during feedback; and several
consecutive rounds. Confirm no old sound starts on the next card, the next card
appears promptly on center, and ending vibration stops on exit. Compare a short
iOS round as a smoke check. Try a second Android motor/display type if available.

Device motor design, amplitude support, display cadence, JS stalls and audio
output latency (especially Bluetooth) prevent an exact cross-platform match.
The remaining replay seek latency and very fast pre-paint feedback transitions
should be measured on device before considering a different audio engine or
moving the whole input/render path to native code.

Sources checked: [Expo SDK 57 DeviceMotion](https://docs.expo.dev/versions/v57.0.0/sdk/devicemotion/),
[Expo SDK 57 Haptics](https://docs.expo.dev/versions/v57.0.0/sdk/haptics/), and
[Android custom haptic effects](https://developer.android.com/develop/ui/views/haptics/custom-haptic-effects),
alongside the installed native sources and the app's iOS Swift implementation.

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
