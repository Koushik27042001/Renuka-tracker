# Windows Android setup

Run the Android build from PowerShell in VS Code. The project uses React Native 0.85.3, JDK 17, Gradle 9.3.1, Android Gradle Plugin 8.12.0, compile and target SDK 36, minimum SDK 24, Build Tools 36.0.0 and NDK 27.1.12297006. CMake 3.22.1 is the installed SDK NDK-module toolchain candidate. React Native's own source build has a separate CMake default. Keep the prebuilt React Native dependency path for this application.

1. Download the JDK 17 Windows archive and checksum from the official Temurin release page. Verify it with `Get-FileHash -Algorithm SHA256` before extracting. [Temurin 17 downloads](https://adoptium.net/en-GB/temurin/releases?version=17)
2. Download the official Windows command-line tools if SDK Manager is absent. Extract to the SDK's `cmdline-tools/latest` so `bin/sdkmanager.bat` is directly within that directory. [Android SDK Manager](https://developer.android.com/tools/sdkmanager)
3. Run the setup script with the selected paths. It configures the current terminal only. Add `-InstallPackages` after approving SDK installation. If SDK Manager asks for licenses, read and accept them interactively as the operator. [Android NDK and CMake setup](https://developer.android.com/studio/projects/install-ndk)

```powershell
.\scripts\setup-android-environment.ps1 -JdkPath $jdk -SdkPath $sdk
.\scripts\check-android-environment.ps1
node --version
npm --version
java -version
javac -version
adb version
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --version
npm ci
npm run build -w @renuka/shared
Push-Location apps/mobile/android
.\gradlew.bat --version
.\gradlew.bat :app:assembleDebug --stacktrace
Pop-Location
```

Gradle uses the configured Android SDK. If an IDE requires `local.properties`, add `sdk.dir` with the absolute SDK path using forward slashes. The file is ignored.

The expected output after a successful build is `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Check the file and size with `Get-Item`. Use Build Tools 36.0.0 `aapt.exe dump badging` to confirm the application ID and version.

The wrapper pins the official Gradle 9.3.1 binary archive checksum. If the wrapper connection times out, verify access to the Gradle distribution service and its download redirect before retrying. Keep the configured version and checksum. [Gradle release checksums](https://gradle.org/release-checksums/)

## This workstation

The verified portable JDK and Gradle wrapper cache are under the ignored .npm-cache directory. The workspace SDK view points to the installed platform and tools plus the verified NDK 27.1.12297006 archive extraction. To use that prepared toolchain from the repository root, run the following in the same terminal as Gradle.

```powershell
$jdk = (Get-ChildItem .npm-cache/jdk17 -Directory | Select-Object -First 1).FullName
$sdk = (Resolve-Path .npm-cache/android-sdk-native).Path
$env:GRADLE_USER_HOME = (Resolve-Path .npm-cache/gradle-native).Path
.\scripts\setup-android-environment.ps1 -JdkPath $jdk -SdkPath $sdk
```
