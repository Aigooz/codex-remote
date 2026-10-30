# Codex Remote

An Android companion for monitoring a Codex desktop session over a paired local network connection.

## Android updates

The app checks the latest public GitHub Release for the configured `owner/repository`. Releases must have a version tag such as `v1.2.0` and include the generated `app-release.apk`. The app downloads the APK and opens Android's package installer. Android installs it over the existing app when the package id and signing certificate match; app data is retained.

To publish a release:

1. Keep `versionCode` increasing and update `versionName` in `android/app/build.gradle`.
2. Configure these GitHub Actions repository secrets using the same keystore that signed the first install:
   - `ANDROID_KEYSTORE_BASE64`: base64-encoded JKS/keystore file.
   - `ANDROID_KEYSTORE_PASSWORD`: keystore password.
   - `ANDROID_KEY_ALIAS`: signing key alias.
   - `ANDROID_KEY_PASSWORD`: signing key password.
3. Push a tag matching the app version, for example `v1.2.0`. The workflow builds a signed APK and attaches it to a GitHub Release.
4. In the app, open Settings, enter the public repository as `owner/repository`, and tap Check for updates.

The release keystore is generated locally at `android/app/release.keystore` and is excluded from Git. Store it and its passwords in a secure password manager and back it up offline. Losing the keystore means Android will not accept in-place updates signed with a replacement key. Never commit the keystore or passwords to the repository.

Android may ask the user to allow this app to install unknown apps once. The final install confirmation is always handled by Android; the app does not silently install updates.

## Desktop bridge

On Windows, open PowerShell in this project directory and run:

```powershell
npm install
npm run bridge
```

The bridge automatically finds the Codex Desktop CLI. It prints one or more `Phone endpoint` addresses and a one-time `Codex Remote pairing code`. Use the address belonging to the same network as the phone, for example `ws://192.168.1.20:4174/remote`, and enter the pairing code in the Android app.

The default target is the example Codex thread used by this project. To monitor another Codex thread, set its id before starting the bridge:

```powershell
$env:CODEX_THREAD_ID = "your-thread-id"
npm run bridge
```

If Codex is installed in a custom location, set `CODEX_BIN` to the full path of `codex.exe`:

```powershell
$env:CODEX_BIN = "C:\Path\To\codex.exe"
npm run bridge
```

Keep the bridge window open while the phone is connected. The computer and phone must be on the same local network, and Windows Firewall must allow Node.js on the private network.
