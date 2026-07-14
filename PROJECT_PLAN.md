# WHATZ IT — MVP Project Plan

## 1. Product Overview

WHATZ IT is a mobile party game inspired by the forehead-guessing game format. A player selects a themed deck, holds the phone against their forehead, and tries to guess the displayed card using clues from the other players.

During a round:

- Tilting the phone downward marks the current card as correct.
- Tilting the phone upward passes the current card.
- The next card appears automatically after either action.
- The round ends when the selected timer expires or the deck runs out.
- A results screen summarizes correct and passed cards.

The first release will be free, work offline, and require no account or backend.

## 2. MVP Goal

Build and validate a polished, reliable core game loop on both iOS and Android without introducing accounts, payments, or server infrastructure.

The MVP is successful when a small group of testers can:

1. Install and open the app without assistance.
2. Understand how to start and play a round.
3. Reliably mark cards correct or passed using phone movement.
4. Select a custom round duration.
5. Complete multiple rounds without crashes, confusing navigation, or duplicate motion events.

## 3. Target Users

- Friends and families looking for a quick party game.
- Players who want a game that works offline and requires minimal setup.
- Small groups at parties, trips, classrooms, or casual gatherings.

## 4. MVP Scope

### Included

- Deck library with 6–10 free categories.
- Approximately 30–50 cards per deck.
- Deck details and instructions.
- Timer presets: 30, 60, 90, 120, and 180 seconds.
- Custom timer between 30 and 300 seconds.
- Pre-round three-second countdown.
- Landscape gameplay.
- Tilt down for correct.
- Tilt up for pass.
- Visual and haptic feedback.
- Correct and passed card tracking.
- End-of-round results.
- Replay and return-to-library actions.
- Local storage for user preferences.
- Offline operation.
- iOS and Android support.

### Not Included

- User accounts or profiles.
- Backend or cloud database.
- Online or remote multiplayer.
- User-created decks.
- In-app purchases.
- Paid subscriptions.
- Advertisements.
- Social sharing.
- Video recording.
- Cloud synchronization.
- Administrative content dashboard.

## 5. Recommended Technology

| Area | Choice | Reason |
| --- | --- | --- |
| Framework | Expo + React Native | Friendly transition from React and straightforward access to native APIs. |
| Language | TypeScript | Safer game-state and data modeling. |
| Navigation | Expo Router | Simple file-based navigation. |
| Motion input | `expo-sensors` | Access to device motion and accelerometer readings. |
| Orientation | `expo-screen-orientation` | Locks gameplay to landscape. |
| Feedback | `expo-haptics` | Provides tactile feedback for correct and pass actions. |
| Screen behavior | `expo-keep-awake` | Prevents sleep during a round. |
| Preferences | AsyncStorage | Stores timer, sound, and onboarding preferences locally. |
| State management | React Context + `useReducer` | Enough structure for the MVP without unnecessary complexity. |
| Builds | Expo Application Services (EAS) | Produces installable iOS and Android test and release builds. |
| Unit tests | Jest | Tests reducers, scoring, timers, and shuffling. |
| Component tests | React Native Testing Library | Tests important screen behavior and user flows. |

## 6. Product Flow

```text
App Launch
    ↓
Deck Library
    ↓
Deck Details and Timer Selection
    ↓
How to Play / Ready Screen
    ↓
3–2–1 Countdown
    ↓
Active Round
    ↓
Round Results
    ├── Replay
    └── Return to Deck Library
```

## 7. Screen Requirements

### 7.1 Deck Library

Displays all available free decks.

Requirements:

- Show deck title, icon, color, description, and number of cards.
- Make deck cards easy to select with one hand.
- Clearly communicate that all MVP decks are free.
- Provide access to basic settings and instructions.

### 7.2 Deck Details and Timer

Allows the user to review a deck and configure the round.

Requirements:

- Show deck name and description.
- Show card count.
- Offer timer presets.
- Offer a custom timer from 30–300 seconds.
- Remember the most recently selected duration.
- Include a prominent Start button.

### 7.3 Ready and Countdown

Prepares the player before sensor input begins.

Requirements:

- Explain correct and pass motions visually.
- Ask the player to hold the phone in the neutral forehead position.
- Lock the game into landscape orientation.
- Display a three-second countdown.
- Calibrate the neutral device position before activating controls.

### 7.4 Game

Displays one card at a time and processes physical input.

Requirements:

- Use large, high-contrast text readable from several feet away.
- Display the remaining time.
- Prevent the screen from sleeping.
- Mark a card correct after a valid downward tilt.
- Pass a card after a valid upward tilt.
- Display distinct full-screen feedback for each result.
- Trigger distinct haptic feedback for correct and pass.
- Register no more than one result per tilt.
- Require a return to neutral before accepting another tilt.
- Clean up sensor listeners and timers when the screen is exited.

### 7.5 Results

Summarizes the completed round.

Requirements:

- Display total correct and passed counts.
- List each card and its outcome.
- Offer Replay and Back to Decks actions.
- Preserve the selected timer when replaying.

## 8. Data Model

Decks will initially ship as local JSON or TypeScript data bundled with the app.

```ts
type Card = {
  id: string;
  text: string;
};

type Deck = {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  version: number;
  cards: Card[];
};

type CardResult = {
  cardId: string;
  outcome: 'correct' | 'passed';
  answeredAt: number;
};

type Round = {
  deckId: string;
  durationSeconds: number;
  startedAt: number;
  endsAt: number;
  currentCardIndex: number;
  cardOrder: string[];
  results: CardResult[];
  status: 'ready' | 'countdown' | 'playing' | 'feedback' | 'finished';
};
```

All decks and cards must receive stable IDs. Stable IDs will support downloadable deck versions, analytics, entitlements, and purchases later without requiring a data migration.

## 9. Game Logic

### 9.1 Round State Machine

```text
ready → countdown → playing → feedback → playing → finished
```

The game reducer should own all round transitions. Screens should render state and send actions rather than modifying round data directly.

Example actions:

- `START_COUNTDOWN`
- `START_ROUND`
- `MARK_CORRECT`
- `MARK_PASSED`
- `SHOW_NEXT_CARD`
- `FINISH_ROUND`
- `RESET_ROUND`

### 9.2 Card Order

- Shuffle cards once at the start of each round.
- Do not repeat cards during a round.
- End the round if all cards are used before the timer expires.
- A replay creates a new shuffled order.

### 9.3 Timer

- Store an absolute `endsAt` timestamp.
- Derive remaining time from `endsAt - Date.now()`.
- Do not rely solely on decrementing a counter once per second.
- Finish the round once and ignore subsequent timer or sensor events.
- Define and test behavior when the app is backgrounded during a round. For the MVP, the safest rule is to finish or pause the round and require explicit resumption.

## 10. Motion-Control Design

Motion recognition is the highest-risk technical area and should be isolated in a reusable `useTiltControls` hook.

The algorithm should:

1. Sample device-motion data at a reasonable frequency.
2. Establish a neutral forehead orientation during the ready screen.
3. Smooth recent readings to reduce sensor noise.
4. Compare the current angle with the calibrated neutral angle.
5. Trigger correct or pass only after crossing a configured threshold.
6. Lock sensor input while feedback is displayed.
7. Require the device to return inside a neutral zone.
8. Rearm input for the next card.

Important concepts:

- **Threshold:** How far the phone must tilt before an action occurs.
- **Hysteresis:** Separate trigger and neutral zones to prevent rapid toggling.
- **Debounce:** A short lock after an accepted action.
- **Smoothing:** An average or low-pass filter over recent readings.
- **Calibration:** A neutral reference that accounts for how each player holds the device.

Development builds should include optional on-screen Correct and Pass buttons. These support emulator development, debugging, accessibility evaluation, and sensor-unavailable devices.

## 11. Suggested Project Structure

```text
src/
  app/
    _layout.tsx
    index.tsx
    deck/
      [deckId].tsx
    ready.tsx
    game.tsx
    results.tsx
  components/
    DeckCard.tsx
    GameCard.tsx
    TimerPicker.tsx
    TiltInstructions.tsx
    RoundSummary.tsx
  data/
    decks/
      animals.ts
      food.ts
      movies.ts
    index.ts
  game/
    gameReducer.ts
    gameTypes.ts
    scoring.ts
    shuffle.ts
  hooks/
    useRoundTimer.ts
    useTiltControls.ts
  storage/
    preferences.ts
  theme/
    colors.ts
    spacing.ts
    typography.ts
  types/
    deck.ts
```

## 12. Delivery Milestones

### Milestone 1 — Project Foundation

Deliverables:

- Create the Expo TypeScript application.
- Configure linting, formatting, and tests.
- Add Expo Router.
- Establish colors, typography, and spacing.
- Add three sample decks with valid IDs.
- Build the deck library and deck details screens.

Acceptance criteria:

- App starts on both an iOS and Android target.
- User can browse and select a deck.
- Deck data is validated and displayed consistently.
- Navigation works without warnings or broken back behavior.

### Milestone 2 — Button-Controlled Game Loop

Deliverables:

- Implement card shuffling.
- Implement the game reducer and state machine.
- Add timer selection and persistence.
- Add ready screen and countdown.
- Build the game screen with temporary Correct and Pass buttons.
- Build the results screen and replay flow.

Acceptance criteria:

- A complete round can be played without motion controls.
- Timer ends at the selected duration without significant drift.
- Each card receives at most one outcome.
- Results accurately match all actions taken during the round.
- Replay starts a fresh shuffled round with the same settings.

### Milestone 3 — Motion Controls

Deliverables:

- Add landscape orientation locking.
- Add neutral-position calibration.
- Implement tilt thresholds, smoothing, debounce, and rearming.
- Add visual and haptic feedback.
- Prevent screen sleep during gameplay.
- Add a development-only sensor diagnostic view.

Acceptance criteria:

- One tilt produces exactly one result.
- Holding the phone beyond a threshold does not advance multiple cards.
- Returning to neutral reliably rearms input.
- Correct and pass work in the supported landscape orientation.
- Sensor listeners are removed when a round ends or the game screen unmounts.

### Milestone 4 — Content, Polish, and Reliability

Deliverables:

- Expand to 6–10 decks.
- Add sound effects and a mute preference if time permits.
- Improve onboarding and instructions.
- Handle app backgrounding and interruptions.
- Add empty-deck and sensor-unavailable states.
- Complete accessibility and small-screen review.
- Add unit and component test coverage for critical logic.

Acceptance criteria:

- No known critical crashes or progression blockers.
- Long card names remain readable.
- Every deck contains unique, reviewed, age-appropriate content.
- Core logic tests pass consistently.
- Testers can begin a game without verbal instructions from the developer.

### Milestone 5 — Beta Distribution

Deliverables:

- Configure application identifiers and EAS build profiles.
- Create app icon and splash assets.
- Produce internal iOS and Android builds.
- Run a structured beta with a small tester group.
- Record and prioritize feedback.
- Fix release-blocking issues.

Acceptance criteria:

- Test builds install successfully on supported physical devices.
- At least one iPhone and one Android model complete repeated rounds.
- No unresolved high-severity motion, timer, or scoring defects remain.
- Privacy policy and store metadata drafts are ready.

## 13. Testing Strategy

### Unit Tests

- Deck validation.
- Shuffle behavior.
- Reducer state transitions.
- Correct and pass scoring.
- Duplicate-action prevention.
- Timer calculations.
- Round completion when time or cards run out.

### Component Tests

- Deck selection.
- Timer selection and validation.
- Countdown behavior.
- Game feedback states.
- Results rendering.
- Replay behavior.

### Physical Device Tests

- Normal head movement does not trigger a result.
- A deliberate tilt triggers consistently.
- One tilt cannot skip multiple cards.
- Rapid alternating correct and pass actions work.
- The phone can return to neutral comfortably.
- Screen orientation and sensor direction are consistent.
- Long rounds remain accurate and the screen stays awake.
- Calls, notifications, app switching, and screen locking are handled safely.

### Suggested Device Matrix

- One recent iPhone.
- One older or smaller iPhone if available.
- One recent Google Pixel or similar Android device.
- One Samsung Android device if available.

## 14. Accessibility and Usability

- Do not communicate outcomes through color alone.
- Use large text and strong contrast.
- Pair visual feedback with haptics and optional sound.
- Respect reduced-motion preferences where practical.
- Ensure timer and setup controls have accessible labels.
- Consider keeping button controls as an accessibility option after the MVP.
- Avoid card content that depends on small imagery during active gameplay.

## 15. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Sensor behavior differs by device | Incorrect or missed actions | Calibrate at round start, tune with multiple devices, and isolate thresholds in configuration. |
| One tilt advances several cards | Core game becomes unusable | Require neutral rearming and add a feedback lock. |
| Timer drifts | Unfair or confusing rounds | Calculate from an absolute end timestamp. |
| Scope expands too early | MVP delivery slows significantly | Keep accounts, backend, payments, and custom decks out of the MVP. |
| Content creates legal or moderation concerns | Store or brand risk | Use original branding, artwork, descriptions, sounds, and card content. |
| Too few physical test devices | Platform defects reach beta | Recruit testers with different iOS and Android devices early. |
| Long card text is unreadable | Poor play experience | Set content length guidelines and test dynamic font sizing. |

## 16. Content Guidelines

- Write original card lists rather than copying commercial game decks.
- Use short, recognizable phrases suitable for large display.
- Avoid duplicate cards across closely related decks when possible.
- Set a recommended maximum length for card text.
- Review spelling, difficulty, cultural sensitivity, and age suitability.
- Keep deck definitions separate from game logic.

## 17. Future Monetization Path

Monetization should begin only after the free core loop is reliable and testers demonstrate repeat play.

### Potential Phase 2 Features

- Paid deck packs through Apple and Google in-app purchases.
- RevenueCat or a similar entitlement service for cross-platform purchase management.
- Downloadable deck manifests and content files.
- Remote deck catalog hosted on a storage service or CDN.
- Restore Purchases flow.
- Featured and seasonal decks.

### Future Deck Entitlement Model

```ts
type DeckCatalogItem = {
  deckId: string;
  version: number;
  access: 'free' | 'paid';
  productId?: string;
  downloadUrl?: string;
  checksum?: string;
};
```

The local MVP data model should not claim that paid decks are owned. Later, the app should derive access from store-verified entitlements and cache downloaded deck content locally.

## 18. Backend Decision

### MVP

No backend is needed. Bundle decks with the app and save preferences locally.

Benefits:

- Faster development.
- No infrastructure cost.
- Full offline play.
- No authentication or privacy burden.
- Fewer failure modes during initial testing.

### Add a Backend Only When Needed

Consider Supabase or Firebase later if the product requires:

- Accounts.
- Cross-device synchronization.
- User-created decks.
- Remotely managed content.
- Cloud analytics beyond standard app analytics.
- Multiplayer sessions.

Purchases should still be verified through Apple, Google, and an entitlement layer rather than trusting a general-purpose database alone.

## 19. Definition of Done for MVP

The MVP is complete when:

- The app can be installed on supported iOS and Android devices.
- All primary screens and navigation paths work.
- At least six original decks are included.
- Timer presets and a valid custom timer work.
- Motion controls reliably distinguish correct and pass.
- A single tilt cannot advance multiple cards.
- Results accurately represent the completed round.
- The app works offline.
- Critical reducer and timer logic has automated coverage.
- Physical device testing has been completed on both platforms.
- No known release-blocking crashes or data-loss issues remain.

## 20. Recommended First Work Session

The first implementation session should complete the following:

1. Initialize the Expo TypeScript project in the repository.
2. Confirm the blank app runs on a physical phone.
3. Add the proposed directory structure.
4. Define `Deck`, `Card`, and `Round` types.
5. Add three small sample decks.
6. Build the deck library screen.
7. Commit the working foundation before beginning the game loop.

The next milestone should be a full button-controlled round. Motion controls should be added only after navigation, timing, scoring, and replay behavior are dependable.
