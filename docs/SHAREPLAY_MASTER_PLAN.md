# SharePlay remote play master plan

Date: October 1, 2026  
Status: Proposed implementation plan. No SharePlay functionality has been implemented or device-tested.

## 1. Goal and recommended first release

Let friends on separate iPhones play WHATZ IT? together while talking over FaceTime. Each person uses their own phone, receives the appropriate game screen, and sees the same accepted score and round outcome.

**Recommended experience:** Choose a deck → Play with friends → invite through SharePlay → lobby → choose a guesser → everyone ready → countdown → play → shared results → next guesser.

The defaults below are recommendations for implementation, not previously approved product requirements:

- iPhone first, with 2–8 active players. Eight is our proposed product/testing limit, not an Apple platform limit.
- One guesser per timed round; everyone else gives spoken clues. Rotate the guesser between rounds.
- Phones stay in portrait and face their owners. The guesser sees a hidden-answer screen, timer, and score. Clue-givers see the answer and byline.
- Assign one clue-giver as the scorekeeper, with **Got it!** and **Pass** controls. Other clue-givers cannot score. The host assigns this role before each round.
- Reuse the existing 30–300 second duration rules. Correct earns one point; passing has no score penalty. Brief answer feedback consumes round time.
- All players see the completed round results. Keep a session scoreboard grouped by guesser, with no competitive ranking until players have had equal turns.
- Start with free decks. Add paid decks only after explicitly choosing and implementing a participant access policy.
- Disable in-app camera/microphone recording in SharePlay. FaceTime supplies the conversation; no call recording or remote video export is included.

First-release exclusions: Android/web participation, public matchmaking, room codes, accounts/friend lists, automatic speech judging, teams, mid-round guesser changes, automatic host migration, and remote Pass n’ Play. Existing local modes remain available.

## 2. Current repository and integration constraints

The current working tree includes ongoing Pass n’ Play changes. Recheck it when implementation starts; do not overwrite those changes or treat historical progress notes as current behavior.

| Area | Current implementation | SharePlay implication |
| --- | --- | --- |
| Runtime | Expo `~57.0.26`, React Native `0.86.3`, React `19.2.3` | Use SDK 57 documentation and compatible native tooling. |
| Navigation | `src/app/_layout.tsx`, `src/app/deck/[deckId].tsx`, `ready.tsx`, `game.tsx`, `results.tsx` | Add dedicated remote routes and an app-level session listener. |
| Local modes | `src/game/game-types.ts`, `game-mode.ts` | Current mode union is Classic/Pass n’ Play; unknown values normalize to Classic. Do not route remote state through that fallback. |
| Rules | `src/game/game-reducer.ts`, `round-transition.ts` | Reuse pure scoring/duration concepts; remote authority and lifecycle need separate state. |
| Runtime side effects | `src/game/round-context.tsx` | Local provider couples cards, timing, recording, and persistence. A remote provider must avoid starting these local effects. |
| Decks | `src/catalog/catalog-provider.tsx`, `catalog-snapshot.ts`, `src/game/round-deck-snapshot.ts` | Capture immutable round content and validate participants’ content versions before play. |
| Commerce | `src/storefront/store-commerce-provider.tsx`, `entitled-deck-preparation.ts` | SharePlay participation is not an ownership grant. |
| History | `src/game/round-result-snapshot.ts`, `src/video/round-videos.ts` | Current saved result snapshots are version 1 and tied to video workflows. Keep remote session results separate initially. |
| Native code | `modules/whatz-it-live-overlay/`, `modules/whatz-it-video-export/` | Follow the existing local module approach for an Apple GroupActivities bridge. |
| Build config | `app.json`, `app.config.js`, `eas.json` | Add reproducible entitlements and build a new native binary. No tracked root `ios/` or `android/` files were found during planning. |
| Audio/transitions | `src/video/round-sound-provider.tsx`, `src/components/screenshot-transition-provider.tsx` | Audit global audio initialization and screenshot caching for FaceTime conflicts and hidden-answer leaks. |

Expo’s versioned SDK 57 documentation lists iOS 16.4+ and Xcode 26.4+ as its baseline. Verify the generated deployment target, selected EAS image, and availability of each selected Apple API in the prototype. Do not advertise support based only on SharePlay’s original minimum OS. [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)

## 3. Platform approach

Use a local Swift Expo module around Apple’s `GroupActivity`, `GroupSession`, and `GroupSessionMessenger`. GroupActivities provides the shared session and app-data transport. Our application still defines game rules, state synchronization, and recovery. [Apple Group Activities](https://developer.apple.com/documentation/GroupActivities)

Use the system `GroupActivitySharingController` for an in-app invitation. It can present a people picker and initiate a FaceTime call when necessary. Handle cancellation as an ordinary return to setup. For an existing eligible session, follow Apple’s preparation/activation flow and handle disabled or cancelled activation explicitly. [Apple sharing controller](https://developer.apple.com/documentation/groupactivities/groupactivitysharingcontroller-ybcy), [activation preparation](https://developer.apple.com/documentation/GroupActivities/GroupActivity/prepareForActivation%28%29)

No new multiplayer backend is proposed for this release. Existing catalog/commerce services still supply content and purchases. This is an architecture choice to validate in the prototype, not a claim that Apple implements the game’s synchronization rules.

### Native module responsibilities

- Scaffold `modules/whatz-it-shareplay/` using the SDK-compatible Expo module tooling; check generated Swift conventions against this project before implementation. [Expo Modules overview](https://docs.expo.dev/modules/overview/)
- Define one custom game activity with stable reverse-DNS activity identity, a session nonce, protocol version, environment, and initiating participant token. Metadata contains a safe title/image and no answers or purchase credentials.
- Observe incoming activities from app startup, including cold launch. Retain native session state until JS is ready; provide a current-state snapshot so an early event is not lost.
- Expose availability, invite/activate, join, send-to-participants, leave, end, and current-session snapshot operations. Emit session, roster, message, and structured error events.
- Preserve the transport-provided sender identity with every message; never trust a sender ID supplied inside a payload.
- Own and cancel Swift tasks/subscriptions deterministically. Ensure one observer and receiver set per session across reloads and navigation.
- Return typed unavailable results on Android/web or builds without the module. Avoid unconditional native imports on unsupported platforms.
- Add `com.apple.developer.group-session` through Expo config/plugin configuration, verify the generated entitlement, and verify signing/provisioning includes it. [Apple capability setup](https://developer.apple.com/documentation/xcode/configuring-group-activities)
- Use compatible activity identifiers within each app environment. Production and staging must reject cross-environment protocol handshakes. Preview currently uses the production bundle identity, so bundle identity alone is insufficient isolation.

Custom native code requires a development/TestFlight/App Store binary containing the module; an OTA JavaScript update cannot introduce it. Existing EAS profiles are the starting point. Local iOS compilation requires a Mac; this Windows workspace can prepare the module and use EAS for builds.

## 4. User flow and screens

1. **Entry:** Add a secondary **Play with friends** action on deck details for supported iPhones. Keep the existing local mode selector intact. Explain briefly that each player needs WHATZ IT? and joins SharePlay on their iPhone.
2. **Invitation:** Present Apple’s sharing interface. Cover unavailable SharePlay, cancellation, app-version mismatch, and invitations received while the app is closed. Participants without the app follow the system’s installation path; verify that experience on devices before documenting it as supported.
3. **Joining:** Finish app/catalog hydration and the protocol handshake before displaying the lobby. If a local round or export is active, ask the player to finish or leave that flow; do not reset it silently.
4. **Lobby:** Show bounded, editable display names, connected/ready status, deck, duration, guesser, and scorekeeper. Do not assume Apple supplies contacts or a usable human name. Host selects settings; settings changes clear readiness.
5. **Ready:** Require at least two eligible connected players, exactly one guesser, a distinct scorekeeper, matching content, and every active player ready. Start with the existing branded countdown style.
6. **Playing:** Guesser sees “You’re guessing” and no answer. Clue-givers see answer/byline; scorekeeper also sees controls. Display pending input until the host accepts it. Keep controls clear of FaceTime’s floating UI on small screens.
7. **Results:** Show the authoritative correct/pass list and score. Reveal completed answers only after the round ends. **Next player** returns everyone to the lobby with the next connected guesser proposed; require readiness again.
8. **Exit:** Distinguish **Leave game** from host **End game for everyone**. Leaving a shared activity and ending it are different native operations. Do not promise to end the FaceTime call. [Apple leave/end semantics](https://developer.apple.com/documentation/groupactivities/groupsession/leave%28%29)

Offer accessible button labels, large-text layouts, reduced-motion behavior, and a clear muted-audio state. Start with haptics and visual feedback; enable game sounds only after testing FaceTime coexistence on speakers and Bluetooth devices.

## 5. State ownership and protocol

### One authoritative host

The initiating app participant is the fixed host for the session. Encode its application token in the activity and bind it to the actual native sender through the initial handshake. Require exactly one binding; fail visibly on a conflicting or missing host. Do not independently elect a host from whichever roster a device happens to see first.

Only the host commits gameplay state. Every other device submits intents and renders an authorized projection of the latest committed snapshot. The host uses the same validation path for its own inputs. Apple’s session transport has no application-level game-host role; we implement it.

Host state includes: session ID, round ID, protocol version, monotonic revision, phase, active roster, readiness, guesser/scorekeeper IDs, pinned deck content hash, private card order, current card nonce, timer state, accepted results, and processed intent IDs. Client state contains only its role-appropriate view.

Suggested state flow:

`idle → inviting/joining → lobby → preparing → countdown → playing ↔ feedback → results → lobby`

`countdown/playing/feedback → paused → countdown/playing/feedback`, with explicit recovery rules. Any phase can transition to ended on invalidation. A session in doubt must cover answers and disable scoring until synchronized.

### Messages and validation

| Message | Purpose |
| --- | --- |
| `hello` / `welcome` | Bind participant identity; negotiate protocol/features, environment, content hash, and host. |
| `readyIntent` / `settingsIntent` | Request readiness or an authorized lobby change. |
| `answerIntent` | Scorekeeper requests correct/pass for one round and opaque current-card nonce. |
| `snapshot` | Host’s full role-filtered state with a revision and accepted intent acknowledgment. |
| `snapshotRequest` | Recover after join, foreground, missing revision, or acknowledgement timeout. |
| `snapshotAck` | Confirm preparation/critical state receipt without claiming another device rendered it. |
| `pauseIntent` / `resumeIntent` / `endIntent` | Request authorized lifecycle changes. |
| `clockProbe` / `clockReply` | Estimate the host clock offset and round-trip delay. |

Every gameplay envelope carries session ID, round ID where applicable, protocol version, message ID, and relevant revision/card nonce. Validate payload shape, size, membership, role, phase, and version at the native boundary and before state mutation. Only accept snapshots from the bound host. Bound message rates, queued work, name lengths, and history sizes.

Use reliable delivery for gameplay and snapshots. Reliable transport does not backfill messages for later joiners; implement snapshot recovery explicitly. Apple documents up to 256 KB for small messages; set a much smaller application budget, such as 16 KB per gameplay message, and test encoded sizes. Never transmit full catalogs or media through gameplay messages. [Apple data synchronization](https://developer.apple.com/documentation/groupactivities/synchronizing-data-during-a-shareplay-activity?changes=_5), [reliable delivery](https://developer.apple.com/documentation/groupactivities/groupsessionmessenger/deliverymode-swift.enum/reliable)

Host validation order: reject wrong session/round → reject unauthorized sender → deduplicate intent ID → validate phase and card nonce → check deadline → apply once → increment revision → distribute snapshots. Receipt after the authoritative deadline is rejected, even if a client reports an earlier tap. Explain late rejection with a resync, never a locally invented score.

Handle send failures, duplicates, delayed messages, and revision gaps. Retry intents with their original IDs, not new scoring requests. Keep a bounded deduplication ledger for the round. A successful send is not proof of application acceptance. Future unknown versions show an update-required screen; they must not fall through to a local game.

### Timing

- Do not send a tick every second or use independent local countdowns as truth.
- Use a host monotonic clock and absolute deadlines in that clock domain. Measure client offset with several request/reply probes and prefer low-round-trip samples; never compare unadjusted `Date.now()` across phones.
- Send role-filtered preparation snapshots and require acknowledgment before scheduling a shared future start. Abort preparation on timeout or membership changes. The first answer becomes visible at the scheduled start, not on preparation receipt.
- Clients derive display time from the synchronized deadline. Host alone accepts expiration and final results. A client reaching zero shows “Finishing…” until confirmed and disables scoring.
- Pause stores remaining duration and phase; resume schedules a new common deadline after readiness and clock checks. Recalibrate after foregrounding. Expiry wins over a pause received after the deadline.
- Target display skew below 250 ms under a healthy connection in the device test suite. Treat this as a measurement target, not a network guarantee. Poor synchronization blocks starting or triggers recovery.

## 6. Hidden answers, content, and purchases

The public snapshot must omit active answer text, byline, catalog card ID, future order, and shuffle seed. Use an opaque per-card nonce for intents. Send current card details only to eligible clue-givers, then clear them when roles or phases change. Host may hold the private state even when it is the guesser, but its view must always use the filtered projection.

This protects ordinary gameplay from accidental disclosure. A participant with a modified client or access to a locally installed deck is outside the first release’s anti-cheat scope.

Do not put hidden content in accessibility labels, navigation parameters, invitation metadata, diagnostics, or screenshot transition caches. Cover the app switcher preview during secret screens where feasible. Do not claim protection against a person deliberately sharing their screen or reading clues aloud incorrectly.

For the free-deck MVP, each participant loads an allowed deck through the existing catalog. Compare a canonical hash of the selected deck’s card content, not just deck ID or overall catalog revision. Pin the agreed content for the round. If hashes differ, refresh before ready; if they still differ, choose a common bundled free deck or stop with a clear explanation. Never silently play mismatched content.

The host selects/shuffles once. Local daily card-memory preferences must not independently change client order. Remember only content actually revealed on that device, if remote play is integrated with local card memory; do not mark every received catalog card as seen.

Paid-deck follow-up choices:

1. **Every participant owns the deck:** reuse verified local entitlement/download flows and check before readiness. Peer readiness is a casual-play check, not proof for granting ownership.
2. **Host-sponsored temporary play:** a separate product/backend design for session-scoped access, expiry, permitted caching, and content rights. Never copy purchase receipts, credentials, or unrestricted paid decks between devices.

Ship free decks first unless the paid access policy is resolved. SharePlay itself does not define the app’s purchase-sharing policy.

## 7. Interruption and recovery policy

| Event | First-release behavior |
| --- | --- |
| New player during a round | Join as waiting; receive safe public state, then enter the next lobby. Do not alter current roles. |
| Nonessential clue-giver leaves | Remove them; continue if guesser, scorekeeper, and host remain available. |
| Guesser or scorekeeper leaves | Host pauses; clear private displays. Return to lobby to assign roles or restart the interrupted round. |
| Fewer than two active players | Pause and offer return to lobby/end. |
| Guest backgrounds | Cover its answer immediately; stop inputs. Host pauses if that player is essential. |
| Host backgrounds | Attempt an authoritative pause immediately. Guests disable inputs after a bounded host-silence timeout; do not assume background JS continues running. |
| Transient network interruption | Show reconnecting, disable affected controls, retry within a bounded window, request a snapshot, then explicitly resume. |
| Host disappears or terminates | End the current app game after a proposed 15-second grace period. Preserve only confirmed results and invite a new session. No automatic takeover. |
| Session invalidated/system ends activity | Cancel receivers/timers, clear secrets, show the reason when available, and return to safe navigation. |
| App killed/reopened | Rejoin only if the native session remains joinable; perform fresh handshake/snapshot sync. Never resume from stale local UI state. |
| Switching local/remote play | Explicit transition, orderly camera/audio cleanup, then session navigation. No two active game providers driving input. |

Add lightweight host presence checks during gameplay, for example every two seconds with controls suspended after six seconds of silence. Tune these proposed thresholds on real networks. A recovered host must reconcile its deadline and issue a fresh snapshot; clients never reconstruct a score from unacknowledged taps.

Session end discards ephemeral names, private card state, and transport buffers. Keep completed results in memory for the results screen. Persistent SharePlay history is a later feature with an explicit schema and retention choice; version-1 local video snapshots must stay readable.

## 8. Proposed file map

All paths below are relative to this repository; new paths are proposals.

| Path | Work |
| --- | --- |
| `modules/whatz-it-shareplay/` | Swift activity/session bridge, Expo registration, TypeScript types, platform fallback. |
| `plugins/with-shareplay.js` | Add if config alone cannot express the required reproducible native setup. |
| `app.json`, `app.config.js` | Entitlement, module/plugin configuration, environment identity, feature flag. |
| `src/shareplay/protocol.ts` | Versioned wire types, schema validation, payload budgets. |
| `src/shareplay/session-reducer.ts` | Pure host rules, authorization, deduplication, deadlines. |
| `src/shareplay/session-projection.ts` | Role-based answer redaction and public/private snapshots. |
| `src/shareplay/session-clock.ts` | Clock probes, offset estimates, countdown display calculations. |
| `src/shareplay/session-provider.tsx` | Native subscription, handshake, intent/snapshot flow, recovery. |
| `src/shareplay/deck-compatibility.ts` | Canonical content hash, frozen deck, access readiness. |
| `src/shareplay/transport.ts` | Native transport adapter and controllable in-memory test transport. |
| `src/app/shareplay/{lobby,game,results}.tsx` | Remote screens; countdown can be a phase within game. |
| `src/components/shareplay/` | Roster, roles, hidden guesser panel, clue panel, connection state. |
| `src/app/_layout.tsx` | Long-lived observer and safe routing after provider hydration. |
| `src/app/deck/[deckId].tsx` | Play with friends entry and selected-deck handoff. |
| `src/video/round-sound-provider.tsx` | Scoped audio behavior compatible with remote sessions. |
| `package.json` | Local module registration if required by scaffold; include new test directory in `npm test`. |

Keep local `GameMode` and saved local results unchanged initially. Model remote gameplay with its own session type rather than appending a value that the existing parser silently converts to Classic. Extract shared pure helpers only where it avoids real duplication.

## 9. Implementation sequence and acceptance gates

### Phase 0 — Native feasibility (first dependency)

- [ ] Re-read SDK 57 docs and current native module instructions; inspect current worktree before edits.
- [ ] Scaffold bridge, add capability, build a development client, verify signed entitlements.
- [ ] On two physical iPhones with separate Apple accounts and separate networks, start/join an activity and exchange a typed message in each direction.
- [ ] Prove targeted messages, sender identity, incoming-session cold launch, leave/end, cancellation, and invalidation.
- [ ] Test FaceTime conversation while app providers mount; verify camera stays off and global sound setup does not disrupt the call.
- [ ] Record actual supported OS/build combinations and lifecycle observations in this document.

**Gate:** two phones communicate reliably through the app’s native bridge and FaceTime remains usable. Resolve native/audio failures before building the full remote UI.

### Phase 1 — Rules and simulated multiplayer

- [ ] Implement schemas, fixed-host binding, reducer, role projection, clock model, and deck handshake.
- [ ] Add a simulated multi-client transport with delay, loss, duplicate delivery, and disconnect controls.
- [ ] Test two- and eight-client rounds, authoritative scoring, expiry, duplicate taps, redaction, protocol mismatch, and recovery.

**Gate:** clients converge on the same accepted results; no hidden answer reaches a guesser projection.

### Phase 2 — Complete free-deck game

- [ ] Build entry, native invitation, lobby, ready states, roles, synchronized countdown, play, results, and next-player flow.
- [ ] Add navigation guards, unsupported-platform behavior, explicit leave/end, and content compatibility errors.
- [ ] Disable recording and ensure replay starts a fresh remote round through lobby readiness.

**Gate:** two people on different networks finish multiple rounds and alternate guessing without developer intervention.

### Phase 3 — Resilience and polish

- [ ] Implement all interruption policies, late join, host disappearance, bounded retries, and return-from-background synchronization.
- [ ] Verify secret content never appears through cached screenshots, VoiceOver, logs, or role transitions.
- [ ] Test four/eight participants, small phones, large text, VoiceOver, reduced motion, Bluetooth, and FaceTime overlay placement.

**Gate:** the matrix below passes; failure states recover or end clearly without duplicated points or silent divergence.

### Phase 4 — TestFlight and release

- [ ] Add a flag that gates both outbound activation and incoming-session handling; define behavior for disabling future sessions while one is already active.
- [ ] Run normal checks, create an iOS build containing the native module, and test matching staging/production identities separately.
- [ ] Pilot with a small group, then expand; capture anonymized error codes and local diagnostics without names or card content.
- [ ] Provide App Review instructions covering two devices, FaceTime, joining, free deck selection, and a full round.
- [ ] Review privacy declarations against what is actually collected; do not automatically change the existing “no collected data” declaration without that review.

**Gate:** physical-device evidence and TestFlight sign-off, including regressions for both local modes. Paid content remains a separate gate.

## 10. Verification matrix

Automated coverage should verify behavior, especially boundaries across native transport, roles, timing, and recovery:

- Two different intents for one card accept at most one outcome; repeated intent IDs never score twice.
- Unauthorized participants cannot score, change roles, end via app commands, or impersonate the host.
- Stale round/card/revision messages and late answers cannot mutate accepted results.
- Wrong environment/version/content hash prevents readiness.
- Guesser snapshots, ready payloads, labels, and diagnostics omit secret content; role changes clear old answers before rendering.
- Offset estimation handles skewed wall clocks; duplicate expiry, delayed countdown, pause-at-expiry, and delayed resume are deterministic.
- Join/reconnect gets a complete current snapshot; a retry after acknowledgment loss applies exactly once.
- Event listeners and native tasks do not duplicate after navigation, reload, or session replacement.
- Existing result snapshots still parse; local Classic/Pass n’ Play scoring, recording, and card memory regressions remain covered.

Physical testing must include:

| Dimension | Required cases |
| --- | --- |
| Devices | Two, four, and eight iPhones; oldest supported OS and current OS; small-screen device. |
| Networks | Separate Wi-Fi networks; Wi-Fi/cellular; weak connection; airplane-mode interruption; route changes. |
| Invitations | Existing FaceTime call; start from app; app foreground/background/closed; cancel; unavailable SharePlay. |
| Lifecycle | Lock/unlock, app switcher, incoming call, host force-quit, guest force-quit, system end, role-holder departure. |
| Gameplay | Every player guesses, fast repeated taps, expiry race, empty/exhausted deck, catalog update mid-round, rematch. |
| Audio | Speaker, wired/Bluetooth headphones, mute, FaceTime audio/video, audio interruption; confirm no recording prompt. |
| Platforms | Android/web still open and play locally without native module errors; no remote compatibility implied. |
| Build variants | Matching production and staging groups; mismatched environment/version rejected; production review build. |

During implementation run `npm run typecheck`, `npm run lint`, and `npm test` after adding SharePlay tests to the script. Run native build verification and physical tests separately; passing JavaScript tests or an Expo export does not prove GroupActivities works.

## 11. Remaining decisions and completion definition

Confirm during prototype/playtesting: whether remote Classic is the preferred rule set, whether players prefer guesser-controlled Pass, whether eight is the right cap, the exact disconnect grace period, and the paid-deck access policy. These do not block writing the native prototype using the defaults above.

The feature is complete when friends on separate networks can invite, join, take turns, finish and replay a synchronized round, and leave cleanly; hidden answers remain hidden in normal gameplay; interruptions produce understandable outcomes; and both existing local modes retain their behavior. A plan, mocked demo, or successful native build alone does not meet that definition.

### First concrete implementation task

Build the smallest two-iPhone SharePlay prototype with the entitlement, activity observer, system invitation, native sender identities, and one typed message. Use a debug-only screen and a free deck. Record device results here before committing to the full lobby and game integration.
