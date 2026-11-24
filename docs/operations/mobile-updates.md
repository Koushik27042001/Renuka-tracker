# Mobile updates

Export the HTTPS API origin and version values from the mobile environment template. On Android, supply the existing approved signing keystore via environment variables. Run `gradlew.bat :app:assembleRelease` from `apps/mobile/android` and verify signatures, version code, and SHA-256 before publishing. Keep the application ID and signing key stable across upgrades.

Use macOS, Xcode, and the company Apple Developer team for iOS. Run the native dependency setup from `apps/mobile/ios` with Bundler and CocoaPods. Export the same public API and marketing version to the archive build process. Set the bundle ID, provisioning and build number in Xcode and distribute through the approved TestFlight, managed, or App Store path.

Test upgrades on physical devices with a queued visit before raising the minimum supported version. Verify permissions, evidence capture, offline recovery and the release link. Keep an operator-approved checksum record for Android.

Verify the Android artifact with the SDK build-tools apksigner utility and record its SHA-256 with PowerShell Get-FileHash. Store the keystore backup and recovery credentials separately with access limited to approved release operators. If distribution is employee-restricted, put the APK on an authenticated company host and use its approved HTTPS download URL in the release configuration.
