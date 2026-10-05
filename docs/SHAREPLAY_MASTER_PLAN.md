# SharePlay remote play master plan

Date: October 1, 2026  
Updated: October 5, 2026 — SharePlay Pass n Play mode and starting-player selection.
Status: Native bridge, live Classic and Pass n Play lobby/game integration, host succession, role projections, clock calibration, and deterministic transport simulation implemented in code. Native compilation and physical FaceTime verification remain open. Treat this as a development build until the device gates pass.

## 1. Goal and recommended first release

Let friends on separate iPhones play WHATZ IT? together while talking over FaceTime. Each person uses their own phone, receives the appropriate game screen, and sees the same accepted score and round outcome.

**Recommended experience:** Choose a deck → top-right SharePlay button → enter or reuse a saved player name → introduction sheet → native invitation → full-screen lobby → choose a guesser → everyone ready → automatic countdown/play → shared results → next guesser.

During an active session, any FaceTime participant can add people to the call through FaceTime's Add People control. The lobby offers those instructions to every player. GroupActivities does not expose which participant invited a later joiner, so show the game starter's shared name as “Started by …” rather than attributing the invitation to that person.

### User-directed placement requirements

- Keep all existing deck setup controls accessible without adding scrolling to that screen.
- Put the SharePlay icon and the visible label **SharePlay** at the top right, opposite the back button in one normal-flow header row that scrolls with the page.
- Use the saved-results screen opened from My Rounds as the visual reference for back/action styling; the deck header must scroll normally.
- Tapping SharePlay opens a sheet with a short description and primary action. Once joined, show a full-screen lobby with a fixed action footer.
- Keep one persistent full-screen container for the joined session, switching between lobby and gameplay without dismissing a native modal. The lobby has no X or swipe-to-dismiss gesture; Leave is its exit action. Name editing, deck search, and host selection remain sheets over the lobby.
- A joined player always sees either the lobby or round, including during temporary snapshot loss and foreground recovery. Local setup flags and local-game state must not hide the joined session. Round option popups close as soon as the round reaches results or ends, before Time's Up is rendered.

The defaults below are recommendations for implementation, not previously approved product requirements:

- iPhone first, with at least two active players and no app-imposed player cap. FaceTime determines the call's participant limit (currently 32). Test larger groups as well as small sessions.
- One guesser per timed round; everyone else gives spoken clues. Rotate the guesser between rounds.
- Phones stay in portrait and face their owners. The guesser sees a hidden-answer screen, timer, and score. Clue-givers see the answer and byline.
- The guesser scores each card with **CORRECT** and **PASS** buttons on their own phone. SharePlay does not use tilt input.
- Reuse the existing 30–300 second duration rules. Correct earns one point; passing has no score penalty. Brief answer feedback consumes round time.
- All players see the completed round results. Keep a session scoreboard grouped by guesser, with no competitive ranking until players have had equal turns.
- Paid decks are available to the whole SharePlay group when at least one connected participant owns the deck. This is the user-approved policy as of October 2, 2026; guests do not need to buy it.
- If the selected deck loses its last connected owner, clear the selection on every device and remove the deck from the available choices. Keep it selected when another connected player owns it. An already prepared round can finish with its pinned cards; the host must choose an available deck for the next round. Returning owners make their decks available again without automatically selecting them.
- Show round length controls only to the host in the lobby. Guests see the formatted duration beneath the deck title.
- After a pause, require fresh readiness from all remaining players and automatically resume with the countdown when everyone is ready.
- Disable in-app camera/microphone recording in SharePlay. FaceTime supplies the conversation; no call recording or remote video export is included.

First-release exclusions: Android/web participation, public matchmaking, room codes, accounts/friend lists, automatic speech judging, and teams. SharePlay Pass n Play was added to the implementation scope on October 5. Existing local modes remain available. Mid-round guesser replacement is implemented for a departing guesser. If the host leaves, a remaining player becomes host and the group returns to a fresh lobby; the old host can rejoin as a player. Preserving an in-progress round across a host change remains future work because only the former host has its private card order and clock.

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

1. **Entry:** Add **SharePlay**, with its platform icon, to the top-right header row on deck details for supported iPhones. Use the existing back row's space; do not add a content button or increase the screen's required scroll distance. Open the introduction sheet described below.
2. **Invitation:** The sheet's **Invite friends** action presents Apple’s sharing interface. Cover unavailable SharePlay, cancellation, app-version mismatch, and invitations received while the app is closed. Cancellation returns to the introduction sheet with settings preserved. Participants without the app follow the system’s installation path; verify that experience on devices before documenting it as supported.
3. **Joining:** Finish app/catalog hydration and the protocol handshake before displaying the lobby. If a local round or export is active, ask the player to finish or leave that flow; do not reset it silently.
4. **Lobby:** Show a full-screen lobby with connected/ready status, decks available from any participant, duration, and the selected guesser. Show the current host's chosen player name above the selected deck for everyone. The host can open a sheet over the lobby and tap another connected player to make them host. Do not assume Apple supplies contacts or a usable human name. Host selects settings; settings changes clear readiness.
5. **Ready:** Require at least two eligible connected players, exactly one guesser, a connected owner of the selected deck, and every active player ready. Start with the existing branded countdown style.
6. **Playing:** Guesser sees “You’re guessing” and no answer. Clue-givers see answer/byline. The guesser taps CORRECT/PASS to submit the result. Display pending input until the host accepts it. Keep controls clear of FaceTime’s floating UI on small screens.
7. **Results:** Show the authoritative correct/pass list and score. Reveal completed answers only after the round ends. **Next player** returns everyone to the lobby with the next connected guesser proposed; require readiness again.
8. **Exit:** Distinguish **Leave game** from host **End game for everyone**. Leaving a shared activity and ending it are different native operations. Do not promise to end the FaceTime call. [Apple leave/end semantics](https://developer.apple.com/documentation/groupactivities/groupsession/leave%28%29)

Offer accessible button labels, large-text layouts, and reduced-motion behavior. SharePlay plays countdown, start, answer, card-flip, final ticks, and end sounds only on the current guesser's phone. Every player receives matching local round haptics. Repeated synchronized snapshots do not replay cues; pause, backgrounding, leaving, and guesser changes stop pending playback. Classic/Pass n Play audio remains blocked while SharePlay owns the flow. Verify audio coexistence with FaceTime on speakers and Bluetooth devices: whether others hear the guesser's speaker depends on microphone processing and their audio route.

### Normal-flow header and sheet design

**Header:** Back on the left; SharePlay icon followed by **SharePlay** on the right. Keep both in one row inside the deck content's ScrollView, respecting the safe area. The user changed the earlier fixed-header direction on October 2; do not pin or absolutely position this row. Match the saved-results header's alignment, weight, and action treatment. The current deck route hides the native stack header and renders its back control through `DeckDetailsHeader`, so inspect/refactor that row rather than assuming a native navigation-bar replacement is necessary. Replace the old in-content back row with the combined Back/SharePlay row; avoid double top padding or consuming an additional row of vertical space.

Style the SharePlay action with the Explore deck details PLAY DECK blue background (#4BCDFD), white text, and a white SharePlay icon, as requested on October 2. Preserve a comfortable touch target and the visible SharePlay label. If the back destination label competes for width, shorten its visible text to **Back** while retaining the full accessible destination label. Do not solve a width problem by stacking actions, hiding SharePlay in a menu, or reducing text to an unreadable size.

**Introduction sheet:** Start at a compact content-fitting height, with a close control and a single primary action. Suggested copy:

> **Play together with SharePlay**  
> Guess with friends over FaceTime, wherever they are. Everyone joins on their own iPhone with WHATZ IT?  
> **Invite friends**

Show the selected deck and duration as a small summary, inherited from deck setup. Keep extended instructions out of this first view. Resolve unavailable or paid-deck states inside the sheet with a short explanation and a usable next step.

**Lobby screen:** After joining, replace the introduction with an opaque full-screen lobby. Keep **Ready**, **Leave**, and host **End for Everyone** visible in a fixed footer; roster/settings content scrolls above it. Incoming participants enter this screen after joining, even if a local setup flag was closed. The host can adjust remote duration here without silently rewriting local-mode preferences.

The lobby uses a plain native View independently of the introduction's animated container. Leaving and rejoining must not carry a sheet translation into the screen; constrain the scroll region so its footer remains reachable.

**Presentation:** Keep one native presentation container across invitation, joined lobby, countdown, gameplay, and results. Render the joined lobby with an opaque background and safe-area padding; change content inside the container rather than handing off between two native modals. Keep the app's established sheet styling for introduction and lobby editors. Verify Apple's invitation controller presentation and return on devices.

**Dismissal:** Before activation, close/swipe returns to deck setup. Once joined, the lobby cannot be dismissed; **Leave** offers **Stay** or **Leave**, and host ending for everyone remains a separate action. Native invitation cancellation must not accidentally end an existing session. When everyone is ready, switch the screen to countdown/gameplay. **Next player** returns to the lobby in the same container. Editor sheets close independently and never dismiss the joined session.

**Layout acceptance:** Compare before/after screenshots on the smallest supported iPhone and the user's usual phone. At standard text sizes, deck artwork, duration, local mode selection, and LET'S PLAY must remain accessible without a scroll, with both header actions visible. SharePlay adds no required scrolling at any supported size. At accessibility text sizes, preserve existing adaptive scrolling if needed for legibility rather than clipping controls; verify the header remains reachable. Check long back labels, safe areas, FaceTime overlays, and return-from-sheet layout. This layout gate comes before integrating the full session flow.

## 5. State ownership and protocol

### One authoritative host

The initiating app participant is the initial host. Encode its application token in the activity and bind it to the actual native sender through the initial handshake. Keep that signed host while present. If the host leaves, elect the same successor on each device from the remaining native participant IDs. If someone joins after the inviter has already left, allow a short handshake window and adopt the active host's claim; if no claim arrives, elect from the roster. The current host can also transfer control to a connected player from the lobby. A returning former host does not reclaim control while the successor is present.

The active host announces its identity to new and returning participants. Host departure assigns a successor automatically; no voting UI is involved. A silent host triggers automatic recovery after eight seconds without a host heartbeat or message, even if its native participant entry remains in the call. Claims and manual transfers carry a monotonically increasing authority generation; older claims cannot displace the successor, and simultaneous claims converge on the same participant ID. A returning former host adopts the current generation. Recover a device whose native participant ID is still bound as host even when its in-memory signing key was lost during a restart.

A transfer message is accepted only from the current host's transport identity. On a host or authority-generation change, clear private round state and clock calibration and return to a fresh lobby; require everyone to get ready again. Test crash/relaunch, simultaneous departures, rejoin, and device suspension on two or more iPhones before release. Repeated warnings and transport diagnostics are throttled while the bounded persistent trace retains distinct events; an iOS crash report is still needed to diagnose a process crash.

Only the host commits gameplay state. Every other device submits intents and renders an authorized projection of the latest committed snapshot. The host uses the same validation path for its own inputs. Apple’s session transport has no application-level game-host role; we implement it.

Host state includes: session ID, round ID, protocol version, monotonic revision, phase, active roster, readiness, guesser ID, deck sponsor ID, pinned deck content hash, private card order, current card nonce, timer state, accepted results, and processed intent IDs. Client state contains only its role-appropriate view.

Suggested state flow:

`idle → inviting/joining → lobby → preparing → countdown → playing ↔ feedback → results → lobby`

`countdown/playing/feedback → paused → countdown/playing/feedback`, with explicit recovery rules. Any phase can transition to ended on invalidation. A session in doubt must cover answers and disable scoring until synchronized.

### Messages and validation

| Message | Purpose |
| --- | --- |
| `hello` / `welcome` | Bind participant identity; negotiate protocol/features, environment, content hash, and host. |
| `readyIntent` / `settingsIntent` | Request readiness or an authorized lobby change. |
| `answerIntent` | Guesser requests correct/pass for one round and opaque current-card nonce. |
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

### Approved policy: one owner shares with the group

On October 2 the user approved the same model as in-person play: if one participant owns a paid deck, everyone in that SharePlay session can play it. Guests do not need matching purchases, paid-card downloads, or permanent catalog access.

- Track the connected deck owner as the content sponsor, independently of the host and guesser roles. Any participant may sponsor a deck; for the current invitation prototype, the owner starts the invitation from their installed deck.
- Check the sponsor's existing verified ownership (including bundle ownership) and playable installed content. Sharing must not manufacture an entitlement or bypass purchase verification on the owner's device.
- Pin the sponsor's deck content/version for the round. The host selects the order once; guest catalog revisions or local daily card memory must not change that order.
- Deliver only the session's required card content to the authorized roles through the SharePlay protocol. Guests can participate even if their catalog has no installed cards for that paid deck. Replace the earlier all-participant paid-content hash/readiness requirement with sponsor-content readiness and acknowledgments of the role-specific payloads.
- Keep guest card payloads in session memory, outside the normal paid-deck installer and ownership database. Clear them on leave, session end, or invalidation. A guest cannot play the paid deck alone afterward unless they purchase it.
- Do not transmit receipts, authentication credentials, full unrestricted paid catalogs, or future answers to the guesser's UI. The sponsor/host may hold the private authoritative content, with role-filtered display as already planned.
- If the sponsor disconnects, pause the round and allow a bounded reconnection window. Another connected verified owner may become sponsor after a fresh readiness check; otherwise return to the lobby and choose a free or another owned deck. Do not continue indefinitely using a departed owner's content.
- Confirm the final policy with tests: one paid owner plus non-owning guests can play; zero owners cannot start a paid round; guests gain no permanent ownership; owner departure pauses access; restored and bundle ownership qualify.

For free decks, existing catalog loading remains available. Pin a canonical content hash/version when selecting a deck and use the authoritative content for the session rather than silently letting different devices play different revisions.

The current implementation permits any connected participant with locally playable content to sponsor the selected deck. The host requests only a bounded set of round cards from that participant and sends role-filtered views. Sponsor handoff after departure still needs implementation.

## 7. Interruption and recovery policy

| Event | First-release behavior |
| --- | --- |
| New or returning player during a round | Add them as a clue giver and send the current role-filtered view. If the prior round ended for lack of players, create a fresh lobby. |
| Clue giver or deck sponsor leaves | Remove them and keep the round and timer running while at least two players remain and the inviter stays. The host already holds the deck content for this round. |
| Guesser leaves | With at least two players remaining, assign a remaining player as guesser, skip the exposed card, and keep the round timer running. |
| Fewer than two active players | End the round and show results to the remaining player. Rejoining creates a fresh lobby and ready states. |
| Clue giver backgrounds, including the host | Cover local answers and stop local inputs, sounds, and haptics. Keep the shared round and deadline running; a host continues publishing while its runtime is available. Verify prolonged iOS suspension and host recovery on devices. |
| Guesser backgrounds, including the host | Request an authoritative pause immediately. Everyone readies again to resume. |
| Player chooses Pause through the X menu | Pause the shared round; require fresh readiness before resuming. No presentation dismissal implicitly pauses gameplay. |
| Transient network interruption | Show reconnecting, disable affected controls, retry within a bounded window, request a snapshot, then explicitly resume. |
| Inviter/host disappears or terminates | If the host backgrounds in the lobby or a paused/completed round, send an immediate host handoff. If the process is killed without a handoff, foreground peers recover automatically after five seconds without a host heartbeat, even if Apple's roster still lists the former host. Authority generations prevent the returning host from reclaiming control. Recovery during active play returns everyone to a fresh lobby because guest views do not include the secret card order. |
| Host selects End Game | Broadcast an authenticated session-end instruction so current participants leave, then end Apple's shared activity. If an older native bridge rejects the elected host, leave locally after the broadcast succeeds. Ordinary invalidation closes the game without showing an error. Real action failures log the native error code. |
| Session invalidated/system ends activity | Cancel receivers/timers, clear secrets, show the reason when available, and return to safe navigation. |
| App killed/reopened | Rejoin only if the native session remains joinable; perform fresh handshake/snapshot sync. Never resume from stale local UI state. |
| Switching local/remote play | Explicit transition, orderly camera/audio cleanup, then session navigation. No two active game providers driving input. |

Guests can keep PASS and CORRECT available through temporary timer calibration gaps while the current host's view still authorizes the guesser to answer. The host validates card nonce and deadline and sends the resulting view; clients never invent a score from unacknowledged taps. Add lightweight host presence checks during gameplay, for example every two seconds, and tune the timeout on real networks.

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
| `src/components/shareplay/setup-sheet.ios.tsx` | One presentation owner for the introduction sheet and persistent joined lobby/game screen. |
| `src/components/shareplay/` | Lobby, editor sheets, roster, hidden guesser panel, clue panel, connection state, and round/results content. |
| `src/components/deck-details-header.tsx` | Separate the normal-flow back/SharePlay action row from the deck hero; preserve other consumers. |
| `src/app/_layout.tsx` | Long-lived observer and safe routing after provider hydration. |
| `src/app/deck/[deckId].tsx` | Normal-flow top-right SharePlay entry, sheet presentation, selected-deck/duration handoff, no added scrolling. |
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
- [x] Add a simulated multi-client transport with delay, loss, duplicate delivery, and disconnect controls.
- [ ] Test two- and eight-client rounds, authoritative scoring, expiry, duplicate taps, redaction, protocol mismatch, and recovery.

Implemented foundations: strict intent parsing, host round state, per-recipient views, content-hash readiness agreement, monotonic countdown/deadline/feedback timing, pauses, guesser-only answers, duplicate rejection, participant departure handling, and clock offset estimation. Two/eight-client simulations cover results convergence after dropped snapshots and duplicate messages. Native device verification, late join/reconnect, and retry transport integration remain open.

**Gate:** clients converge on the same accepted results; no hidden answer reaches a guesser projection.

### Phase 2 — Complete shared-deck game

- [ ] First verify the normal-flow back/SharePlay header preserves the current no-scroll deck setup layout on physical phones.
- [ ] Verify the compact introduction sheet, native invitation, full-screen lobby, ready states, roles, synchronized countdown, play, results, and return-to-lobby flow on devices.
- [ ] Verify editor sheet sizing, fixed lobby footer, invitation presentation/cancellation, and persistent joined-session visibility. Confirm that Leave is the lobby exit and no round X popup covers Time's Up.
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

**Gate:** physical-device evidence and TestFlight sign-off, including regressions for both local modes. Session-scoped sharing of paid content is included in the gameplay acceptance gate.

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

Confirm during prototype/playtesting: whether remote Classic is the preferred rule set, the exact disconnect grace period, and the exact sponsor-departure grace period. The user has chosen no app-imposed player cap. The paid-deck policy and guesser-controlled buttons are settled. These do not block writing the native prototype using the defaults above.

The feature is complete when friends on separate networks can invite, join, take turns, finish and replay a synchronized round, and leave cleanly; hidden answers remain hidden in normal gameplay; interruptions produce understandable outcomes; and both existing local modes retain their behavior. A plan, mocked demo, or successful native build alone does not meet that definition.

### First concrete implementation task

Build the smallest two-iPhone SharePlay prototype with the entitlement, activity observer, system invitation, native sender identities, and one typed message. Use a debug-only screen and a free deck. Record device results here before committing to the full lobby and game integration.

## Implementation progress — October 2, 2026

Implemented on `codex/pass-n-play`:

- Normal-flow Back/SharePlay row inside deck setup's existing ScrollView. Reuses the original row height and page padding; no new content row. SharePlay matches PLAY DECK's #4BCDFD background with white text/icon. Physical layout verification is still pending.
- Native Expo UI setup sheet, selected-deck summary, invitation/cancellation, incoming session acceptance, roster, explicit leave/end, and targeted connection checks. This is explicitly labeled a development preview; there is no Start game button yet.
- Local Swift module in `modules/whatz-it-shareplay/`, discovered by Expo autolinking without a new npm dependency. Includes GroupActivities capability configuration, native session/sender identities, current-state snapshots, bounded messages, and task/subscription cleanup.
- SharePlay enablement in JavaScript configuration and native Info.plist now includes production/TestFlight builds. `EXPO_PUBLIC_SHAREPLAY_DISABLED=true` disables it explicitly. Production builds made before this change need a new native build to include the enablement flag and entitlement.
- Versioned ping/pong protocol with environment checks, membership validation, targeted acknowledgments, timeouts, bounded replies, and stale-session rejection. This is a transport feasibility check, not the future authoritative game protocol.
- Local sound-session activation is scoped to local ready/game routes and guarded while SharePlay owns the flow. No SharePlay camera or microphone capture is started.

Validation: full suite passed 312 tests before the final build-gating test was added; the subsequent targeted SharePlay suite passed all six tests. TypeScript and no-cache lint passed again after the final header and sheet refinements. Full lint had zero errors and four pre-existing warnings. iOS, Android, and web Metro exports succeeded. These checks do not establish native compilation, sheet layout, or FaceTime behavior.

The internal iPhone build failed at signing because its existing provisioning profile does not include Group Activities / `com.apple.developer.group-session`: https://expo.dev/accounts/cades-team/projects/whatz-it/builds/aa7484c0-5f30-412d-bf2e-f9bf85e87a69 . No credentials were replaced. The user will handle the next iOS development build and provisioning update. A simulator compile was already submitted before that instruction: https://expo.dev/accounts/cades-team/projects/whatz-it/builds/49ba267e-c401-4831-af0b-ee064e4e2874 . Its temporary compile profile is `shareplay-simulator`; this cannot produce an installable phone app.

### Next device check

1. Build the `development` profile with Group Activities enabled in the Apple App ID and a regenerated provisioning profile containing that capability. Include both testers' devices for internal distribution.
2. Install matching builds on two iPhones and connect both to the same compatible development bundle/environment.
3. Open a free deck. Verify the Back/SharePlay row scrolls normally, the blue button uses white text/icon, and no extra scrolling is required at standard text size.
4. Open SharePlay, inspect the sheet, invite a friend through the system interface, and join on the second phone. Check cancellation and reopening as well.
5. Tap Check connection on each phone. Each should confirm the other participant acknowledged its message. Test departure, rejoin, and a failed/retried check.
6. Verify FaceTime remains audible, no recording permission is requested, and returning to local Classic/Pass n' Play restores normal gameplay/audio.
7. In the new protocol-3 build, have both players mark ready and finish a free-deck Classic round. Confirm countdown, clue card on the clue-giver phone only, guesser-controlled PASS/CORRECT buttons, one accepted result per card, matching score/results, pause/resume, and Play Again with a new guesser.
8. Repeat with a paid deck owned only by a guest. Confirm the inviter can select it from the lobby, the group can play without everyone buying it, and only clue-givers receive the current answer.
9. Check leaving, ending for everyone, host departure, and background/foreground recovery while a round is active.

The live Classic lobby, role-filtered cards, synchronized countdown/scoring, and results are now implemented in code. Their completion still depends on native compilation and physical-device testing. The next development focus is the device gate, UI refinements observed on iPhone, and recovery for late join and interruptions.

### October 2 follow-up — timer and shared ownership

The preset round-length buttons were restored at the user's request. The custom duration control remains below them without a CUSTOM TIMER label, retaining the 30–300 second limits.

Paid-deck policy is approved: one connected owner supplies the deck for the group. The app checks each participant's locally installed content and ownership before advertising or supplying a deck. The host can select a deck owned by any participant, and sends only the active card to eligible clue-givers. Sponsor handoff after departure remains open.

### October 2 continuation — live Classic integration

- Protocol version 2 commits a native-generated Curve25519 host public key to the GroupActivity. The native bridge signs host messages over the session ID, native sender ID, and message body, then marks only verified host packets for JavaScript. The guest accepts game views only from that authenticated host.
- The Swift bridge qualifies ExpoModulesCore.Record explicitly, addressing the earlier Combine `Record` ambiguity reported by the simulator build. Its new signing path still needs a native compile.
- The provider now binds the native roster to a host-owned `RemoteRound`. A connected participant with local access supplies a shuffled round of cards and content hash. Every participant sees only a targeted projection; the guesser view has no active answer, but carries the opaque token required to submit Pass/Correct. The host may guess, but its local authoritative engine necessarily holds round cards in memory; its rendered view is filtered.
- The native setup sheet now offers shared deck and guesser selection and readiness; the countdown starts automatically when all named players are ready. The remote screen has countdown, role-specific clue/guesser views, guesser-only PASS/CORRECT buttons, pause/resume, a brief Time's Up screen on timer expiration, shared results, and a new round that rotates the guesser. Remote play does not start local recording.
- Clock probes estimate the host's monotonic time. Guests request current views after reconnecting or returning to foreground. Temporary timer calibration gaps do not hide cards or disable answer controls while the current host's view authorizes scoring. Departures keep an active round running when at least two players and the host remain. When the host leaves, a successor is selected and everyone returns to a new lobby; continuing the old round would require transferring its private state and clock.
- JavaScript tests now cover strict view decoding, native-host admission, a two-client owner/guest lobby-to-countdown flow, host-guesser redaction, and the earlier two/eight-client engine simulations. These do not prove native compilation or FaceTime behavior.

Remaining before release: compile the new Swift protocol-3 bridge; test invitation, joining, sheet-to-game transitions, card secrecy, scoring, results, and FaceTime audio on two physical iPhones; then test late join, host force-quit, app backgrounding, and four/eight-person sessions. Sponsor handoff, a session scoreboard, remote duration editing in the lobby, and persistent remote history are still open. The device gate in Phase 0 remains unchecked.

### October 2 continuation — group decks and guesser controls

- Each joined phone advertises the deck IDs it can play. The host's lobby lists their union. If a guest owns the selected deck, the host requests only 20 shuffled round cards from that guest over the targeted SharePlay channel, verifies the content hash, and keeps those cards in memory for that round. No purchase or ownership flag is granted to the other phones. The local app enforces ownership before advertising or supplying cards; without a backend, this is not independent server verification of a guest's purchase.
- The host prefers its own copy when available. Guest-owned paid decks can be played even when the inviter has no access. If the sponsor departs during play, the round pauses and cannot resume until a new round is prepared with an available sponsor.
- The guesser alone can submit Correct/Pass using buttons. Their view omits answer text and includes the opaque current-card token. The host may choose any connected guesser in the lobby; Play Again proposes the next participant. Each role change creates a fresh round and clears readiness.
- Protocol 3 changes both native invitation compatibility and JS wire messages. A new iOS development build on every participating phone is required. Physical iPhone testing must confirm button placement around the FaceTime overlay and cross-owner paid deck behavior before release.

### October 2 device-test follow-up — connection and visual cohesion

The first two-phone attempt showed both players in the SharePlay sheet, but connection confirmation/readiness did not converge and one participant was repeatedly removed. The exact native invalidation cause has not yet been captured. The next build joins an incoming activity automatically, reads the current native session state when queued callbacks run so an old waiting event cannot overwrite joined, and retries missing deck-inventory requests after early delivery loss. Peer connection checks now retry automatically. Ready can be tapped as soon as the lobby appears while clock calibration continues; scoring still requires synchronization. The startup retry has an automated lost-message test. Native invalidation now surfaces Apple's reason in the sheet so a repeat can be diagnosed. Re-test all transitions and capture the displayed error plus build IDs if a phone still leaves.

The SharePlay setup sheet now uses the app's colors, fonts, cover card, custom dropdowns, and orange primary buttons. It still uses system invitation UI, which Apple owns. The full-screen game already uses custom controls and now uses the same typography. Verify small-screen scrolling, sheet-to-game dismissal, and FaceTime overlay clearance on device.

### Two-phone debugging trace

The SharePlay round presentation now follows the portrait Pass n Play layout: one blue-bordered card with the deck title, a centered clock and answer, large guesser-only PASS/CORRECT controls, matching blue countdown and green/orange feedback, and a framed results list. The answer text sizing and feedback takeover are shared components. Device review should check small phones, FaceTime overlays, and secret-answer visibility when moving through the app switcher.

The latest two-phone logs show both participants joined the same activity and outbound messages reported success, but neither phone recorded a native receive event. The host created a lobby while the guest never received it; the host never received the guest's inventory or probe replies. The native messenger now sends encoded `Data` instead of a custom Swift message type, retaining targeted delivery and the host signature. The receiver logs startup, decode failures, and delivered message types. The activity protocol is version 4 so an older message format cannot silently join this test. Both phones need the new native build. Physical two-phone verification remains.

The host's deck dropdown has been replaced by a searchable deck sheet. It lists the catalog with covers; decks owned by at least one participant are selectable, and other decks remain visible with an availability label. The guest's setup text now waits for the host's view without incorrectly claiming no one owns the selected deck.

Development builds record SharePlay session, transport, peer checks, deck setup, clock sync, and ready/start transitions on each iPhone. The native bridge also prints `[SharePlay]` events to the Xcode device console and forwards them into the app's bounded flight recorder. The log contains message types, byte counts, shortened session/participant IDs, and error codes; it omits card text, full wire payloads, keys, and purchases. Repeated clock and snapshot traffic is sampled.

On **both** phones, open the SharePlay sheet after a failed attempt and tap **SHOW SHAREPLAY DEBUG LOG**, then **REFRESH LOG**. Select and copy the trace, or use the existing Contact Support action to attach it with app diagnostics. Compare timestamps around `session.attach`, `session.snapshot`, `connection.status`, `inventory.received`, `round.created`, `action.request`, and `intent.result`. A new iOS development build is required for the native bridge events; JavaScript-only updates will show the game/provider trace but cannot show native events.

### October 3 — backgrounding and rejoining after a fresh launch

- Backgrounding keeps the player in the lobby. Existing round behavior remains: backgrounding the guesser pauses the round; backgrounding a clue giver does not.
- Remember the joined activity on the device. A fresh app launch encountering that same activity offers a branded **Rejoin SharePlay?** popup with **YES** and **NO**. Returning from the background does not prompt. Yes rejoins the lobby; No allows ordinary app use while remaining in the FaceTime call.
- The rejoin prompt and lobby share one native modal. Acceptance switches its content directly so presenting the lobby cannot race with dismissal of a separate prompt modal on iOS.
- Game participation is tracked separately from Apple's activity roster. Pending or declined rejoin removes that player from the game roster and host selection. Ordered presence messages prevent delayed updates from restoring someone who declined, and roster changes notify newly joined peers of the decision. Explicit Leave clears the remembered activity.
- Immediate departure on force-quit cannot be guaranteed: iOS may terminate a suspended process without invoking its termination callback. React immediately to Apple's participant-roster changes; retain host timeout recovery when Apple has not reported departure. Missing app responses alone cannot reliably distinguish background suspension, force-quit, and a network interruption. Do not eject backgrounded players based solely on silence. [Apple termination callback](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/applicationwillterminate(_:)), [SharePlay participants](https://developer.apple.com/documentation/groupactivities/groupsession/activeparticipants).
- Device verification still required: background/foreground without a prompt; force-quit/reopen and select Yes; reopen and select No while peers keep playing; new participant joins after No; remaining player ends the game while a declined device stays in the call. JS refreshes in development may also show the fresh-launch prompt.

### October 5 — SharePlay Pass n Play

- The host selects Classic or Pass n Play in the Lobby using the existing branded mode selector. Guests see the shared mode. Classic keeps one guesser for the round. In Pass n Play the outlined Lobby row is labelled **STARTING PLAYER**, and the host taps a row to choose who goes first. Editing a name still works independently.
- In Pass n Play, the starting player sees the answer and gives clues to everyone else, matching local Pass n Play. They control PASS/CORRECT. PASS advances the card for that same clue giver. CORRECT shows the usual feedback, moves to the next participant in round roster order, and enters a handoff screen. Everyone's timer keeps running. The next clue giver taps **START MY TURN** to reveal their answer; everyone else guesses and never receives the answer. The loop includes the host and wraps to the starting player.
- Only the current turn owner can score or start their turn: Classic's guesser or Pass n Play's clue giver. Handoffs use opaque, single-use tokens so delayed actions cannot reveal or score a new card. Changing mode or starting player clears Lobby readiness. Pausing during correct feedback or a handoff preserves the next player; after everyone readies, the countdown returns to that handoff. Player departures retain the existing two-player minimum and host recovery rules.
- Answer cards include a small footer instruction: Classic says **Try to get [guesser name] to guess this answer.** Pass n Play says **Try to get the rest of the group to guess this answer.**
- Mode is synchronized in deck selections and targeted game views, including late joins and host recovery. Older views without a mode remain Classic. All testing phones need the updated JavaScript; this addition changes no Swift code and needs no new native build by itself.
- Automated coverage includes two-client synchronization and snapshot recovery, an eight-player rotation, answer secrecy, incorrect/stale reveal actions, deadline expiry during handoff, pause/resume, starting-player selection, departure, and sound/haptic cue planning. Physical iPhone checks remain: choosing the mode and starting player, a full rotation across separate phones, FaceTime overlay clearance, pause/background/force-quit recovery, and shared paid decks.

### Future idea — shared video recap

The user is interested in saving a round as a video grid of all players' FaceTime views. Keep this separate from the first SharePlay release and investigate feasibility before promising it in the app. Apple's GroupActivities API synchronizes app state and does not provide the app with participants' FaceTime video frames. ReplayKit can record an app's screen and audio, but it does not provide a documented feed of every participant's FaceTime camera view. Running WHATZ IT?'s own camera capture during FaceTime may also encounter camera/audio-session contention; test on physical devices before designing this path. [GroupActivities](https://developer.apple.com/documentation/GroupActivities), [ReplayKit](https://developer.apple.com/documentation/replaykit), [AVCaptureSession interruptions](https://developer.apple.com/documentation/avfoundation/avcapturesession/interruptionreason/videodeviceinusebyanotherclient)

If a video recap is feasible through a separate recording flow, require each player to opt in and review their own clip before sharing it. Plan for upload/compositing, clear retention and deletion controls, and much larger storage than text-only round history. Preserve text-only history as the lightweight default.
