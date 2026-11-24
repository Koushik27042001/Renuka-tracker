# Android signed release

The company operator controls the signing identity. For a first release, use the approved Java `keytool -genkeypair` process under the company key custody policy and have the operator enter passwords interactively. For updates, use the existing key and application ID. Keep a separately protected backup and recovery record. Keep the keystore outside the checkout.

For a newly approved key, the operator can run the following from a secure terminal. Assign the approved path to $companyKeystore first. Keytool prompts for passwords and certificate details.

```powershell
keytool -genkeypair -v -keystore $companyKeystore -storetype PKCS12 -alias renuka-tracker -keyalg RSA -keysize 3072 -validity 10000
```

Set `MOBILE_API_URL` to the approved HTTPS staging or production API origin and `MOBILE_APP_VERSION` to the approved semantic version. Set a higher `ANDROID_VERSION_CODE` for each distributed upgrade. Supply `ANDROID_SIGNING_STORE_FILE`, `ANDROID_SIGNING_STORE_PASSWORD`, `ANDROID_SIGNING_KEY_ALIAS`, and `ANDROID_SIGNING_KEY_PASSWORD` through the protected build environment.

```powershell
Push-Location apps/mobile/android
.\gradlew.bat :app:assembleRelease --stacktrace
$apk = Resolve-Path 'app/build/outputs/apk/release/app-release.apk'
& "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs $apk
& "$env:ANDROID_HOME/build-tools/36.0.0/aapt.exe" dump badging $apk
& "$env:ANDROID_HOME/build-tools/36.0.0/aapt.exe" dump permissions $apk
Get-FileHash -Algorithm SHA256 -LiteralPath $apk
Pop-Location
```

Compare the reported signing fingerprint with the approved certificate. Verify package `com.renukatracker`, expected version and absence of debuggable and background location declarations. Inspect the bundled API origin and run the APK without Metro. Upload after operator authorization. Use the existing version and download-page configuration to publish the checksum, release date and approved private HTTPS link.

iOS requires a macOS environment, Xcode, CocoaPods, Apple signing and provisioning access, and a physical iPhone. Follow the [mobile update runbook](../operations/mobile-updates.md) for archive and approved distribution.
