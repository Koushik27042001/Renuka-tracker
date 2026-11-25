# Build the Android APK on GitHub Actions

The **Android APK Build** workflow produces a signed `com.renukatracker` APK with the React Native JavaScript bundle included. GitHub's Ubuntu runner supplies the build tools. Installing and using the APK on a phone requires no local Android Studio, Android SDK, Java, or Metro.

## Repository secrets

In GitHub, open **Settings → Secrets and variables → Actions → New repository secret**. Reuse the existing mobile settings and add the four signing entries.

| Secret | Value |
| --- | --- |
| `MOBILE_API_URL` | `https://renuka-tracker.onrender.com` with no trailing slash or path |
| `MOBILE_APP_VERSION` | Release version, for example `1.0.0` |
| `ANDROID_VERSION_CODE` | Positive integer, for example `1` for the first release |
| `ANDROID_SIGNING_STORE_BASE64` | Base64 encoding of the approved binary keystore |
| `ANDROID_SIGNING_STORE_PASSWORD` | Keystore password |
| `ANDROID_SIGNING_KEY_ALIAS` | Alias in the keystore, for example `renuka-tracker-staging` |
| `ANDROID_SIGNING_KEY_PASSWORD` | Password for that alias. For a new PKCS12 keystore created with the command below, use the store password. |

The workflow creates `ANDROID_SIGNING_STORE_FILE` on the runner and removes it when the build step exits. Base64 is an encoding. Treat the encoded value and binary keystore as secrets. The APK contains the public API origin and version.

## Create or select a signing key

Use the existing signing key if testers already have an APK they need to update in place. For a first sideloaded test release, create a dedicated staging keystore once on a trusted machine with a JDK. Android Studio and an Android SDK are unnecessary for key generation. Keep the encrypted keystore and passwords in the team's protected storage. If you later choose a different production key for the same package ID, uninstall the staging app before installing the production APK. Uninstalling removes the app's local data.

Run these commands from PowerShell on the trusted machine. Set the path to a protected location outside the checkout. Keytool prompts for the password and certificate details. The GitHub CLI command submits the base64 value through stdin without displaying it. Alternatively, enter the base64 value directly in the GitHub secret form using a trusted local clipboard.

```powershell
$keystore = 'C:\AndroidKeys\renuka-tracker-staging.p12'
keytool -genkeypair -keystore $keystore -storetype PKCS12 -alias renuka-tracker-staging -keyalg RSA -keysize 3072 -validity 10000
if ($LASTEXITCODE -ne 0) { throw 'Keystore generation failed.' }
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore)) |
  gh secret set ANDROID_SIGNING_STORE_BASE64 --repo Koushik27042001/Renuka-tracker
```

Enter the alias and passwords in the GitHub secret form. For an existing keystore, use `keytool -list -keystore <path>` to check the alias. Use the same retained signing identity for later updates.

## Run and install

1. Commit and push the workflow to `main`.
2. In GitHub, open **Actions → Android APK Build → Run workflow**, select `main`, and start the run.
3. Open the successful run and download **renuka-fieldforce-android-apk** under **Artifacts**. Extract the ZIP. It contains `app-release.apk`, `app-release.apk.sha256`, and `build-info.txt` with the version, version code, commit, and ref.
4. Compare `Get-FileHash -Algorithm SHA256 .\app-release.apk` with the checksum in the artifact.
5. Transfer the APK to your Android phone and open it. If Android prompts, allow installation from the file manager or browser you used to open it. Launch the app and sign in with an employee account to verify access to Render.

For each update, keep the package ID and signing key, increment `ANDROID_VERSION_CODE`, set `MOBILE_APP_VERSION`, and run the workflow again. Publishing in-app updates also requires a hosted APK and the corresponding release metadata on Render. See the [mobile updates runbook](../operations/mobile-updates.md).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Workflow missing from Actions | Check that `.github/workflows/android-build.yml` is on the repository's default branch and GitHub Actions is enabled. |
| Mobile settings validation fails | Verify the three mobile secrets. The API URL must be an HTTPS origin. The version must have three numeric components. The version code must be a positive integer with at most nine digits. |
| Signing fails | Verify the four signing secrets. Re-encode the original keystore if necessary. Confirm the selected alias has a private key and the passwords match. |
| SDK or Gradle fails | Open the failed step. The workflow uses Node 24, JDK 17, Gradle 9.3.1, AGP 8.12.0, Android SDK 36, Build Tools 36.0.0, NDK 27.1.12297006, and CMake 3.22.1 for the SDK native modules. |
| APK refuses to update | Confirm that the installed app uses the same signing key and that the new version code is higher. |
| App cannot sign in | Confirm the Render readiness endpoint at `https://renuka-tracker.onrender.com/api/health/ready` and check the employee account. |
