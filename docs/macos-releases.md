# macOS releases and updates

Users install Nooki from the universal DMG in GitHub Releases. Once a build with the updater is installed, Nooki checks for a newer stable release at startup and in Settings. The user reviews the version and notes and chooses **Update and restart**. Nooki verifies the package and signed version, checks for active or queued tasks, and gives the task worker time to release ownership before replacing the app. Library, conversation, and task data remain in the existing app data directory.

Local builds use the regular desktop build and install commands. Only the release build receives the updater configuration and production signing credentials. An existing installation without the updater needs one manual DMG upgrade.

## Prepare the release environment

In the repository's GitHub Actions settings, create an environment named `release` and restrict deployment branches to `master`. Keep the Tauri updater private key in a secure backup. All releases served to an installed build must use the signing key it trusts.

| Environment variable | GitHub setting | Value |
| --- | --- | --- |
| `NOOKI_UPDATE_PUBLIC_KEY` | Variable | Contents of the `.pub` file from `npm exec -- tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY` | Secret | Contents of the matching private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Secret | Passphrase if one was used |
| `APPLE_SIGNING_IDENTITY` | Variable | Full `Developer ID Application` identity |
| `APPLE_CERTIFICATE` | Secret | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Secret | Password for the `.p12` export |
| `APPLE_API_ISSUER` | Secret | App Store Connect API issuer ID |
| `APPLE_API_KEY` | Secret | App Store Connect API key ID |
| `APPLE_API_KEY_P8` | Secret | Contents of the matching `.p8` file |

Tauri's updater signature and Apple's code signature serve separate purposes. The updater validates the archive and version. macOS uses the Developer ID signature and notarization to assess the downloaded app.

## Publish a version

1. Review and merge the version changes to `master`. The npm package, Cargo package, and Tauri bundle must carry the same stable version.
2. Create the matching version tag on that commit, such as `v0.4.0` for version `0.4.0`.
3. Run **Prepare macOS release** from `master` while it points to that tagged commit. The workflow tests, signs, and uploads a universal DMG, update archive, signature, and `latest.json` to a release draft.
4. Review the draft and verify the DMG on a Mac. Test an upgrade from the previous updater-enabled release and check that the app reopens with existing data. Publish the draft as the latest release when ready.

The draft's update manifest contains the generated notes. If you revise the notes before publication, update the `notes` field in `latest.json` and replace that draft asset. Keep the version, URL, and signature fields from the build.

[Tauri updater](https://v2.tauri.app/plugin/updater/) · [macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
