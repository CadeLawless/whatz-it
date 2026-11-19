# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Repository map

WHATZ IT is delivered from three independently deployed sibling repositories:

- `whatz-it`: Expo/React Native mobile app and cross-system architecture plans.
- `whatz-it-landing-page`: static public website.
- `whatz-it-deck-platform`: PHP API, Deck Manager, database migrations, and catalog publishing.

For work spanning repositories, read each affected repository's instructions and inspect its Git status before editing. Keep tests, commits, and deployment steps repository-specific. Treat the versioned platform API and catalog formats as compatibility seams: deploy backward-compatible platform changes before dependent mobile changes, and retain compatibility until supported app versions no longer need it.

Run `scripts/start-codex-suite.ps1` to give a Codex CLI session access to all three repositories.
