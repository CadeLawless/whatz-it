# Uploading an EAS-built IPA to TestFlight with GitHub Actions

This workflow uploads an existing store-signed IPA directly to Apple from a
GitHub-hosted macOS runner. EAS Submit is not used.

## One-time GitHub setup

Open the `CadeLawless/whatz-it` repository on GitHub, then go to **Settings →
Secrets and variables → Actions**. Add these repository secrets:

- `ASC_KEY_ID`: the App Store Connect Team API key ID.
- `ASC_ISSUER_ID`: the App Store Connect issuer UUID.
- `ASC_PRIVATE_KEY`: the complete contents of `AuthKey_<KEY_ID>.p8`, including
  the `BEGIN PRIVATE KEY` and `END PRIVATE KEY` lines.

The Team API key must have permission to upload builds. The existing App
Manager key used by Deck Manager has sufficient access. Do not commit the
`.p8` file or any of its contents to this repository.

The workflow must be present on the repository's default branch before GitHub
shows its **Run workflow** button.

## Upload a build

1. Build the iOS app with the EAS `production` profile and wait for the build
   to finish.
2. On the EAS build page, copy the direct IPA download URL. It normally begins
   with `https://expo.dev/artifacts/eas/` and ends with `.ipa`.
3. On GitHub, open **Actions → Upload IPA to TestFlight → Run workflow**.
4. Paste the direct IPA URL into **Direct HTTPS URL for the store-signed IPA**
   and run the workflow.
5. Open the workflow run and wait for **Upload IPA to Apple** to report a
   successful delivery.
6. Open the app's **TestFlight** tab in App Store Connect. Apple must process
   the uploaded build before it becomes available to tester groups.

The manual IPA URL is recorded as workflow input and is visible to users who
can view the repository's Actions runs. Treat the opaque EAS artifact URL as
temporary release information and do not share it outside the release team.

## Troubleshooting

- `The IPA URL must use HTTPS`: copy the direct artifact link rather than a
  local file path.
- `End-of-central-directory signature not found`: the URL returned an HTML
  page or expired response instead of an IPA. Copy a fresh direct download URL.
- `Missing ASC_* repository secret`: add the named secret under the mobile
  repository, not the Deck Manager repository.
- Authentication errors: confirm that the key ID, issuer ID, and `.p8` file
  belong to the same App Store Connect Team API key.
- Duplicate build errors: create a new store build with a higher iOS build
  number; Apple will not accept the same build number twice.
- A successful upload that is not yet visible in TestFlight is normally still
  processing. Check App Store Connect and the Apple account's email for
  validation or compliance issues.
