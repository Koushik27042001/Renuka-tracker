[CmdletBinding()]
param([string]$JdkPath = $env:JAVA_HOME, [string]$SdkPath = $env:ANDROID_HOME)
$root = Split-Path -Parent $PSScriptRoot
if (!$SdkPath) { $SdkPath = $env:ANDROID_SDK_ROOT }
if (!$SdkPath) { $SdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (!$JdkPath) {
    $jdk = Get-ChildItem (Join-Path $root '.npm-cache\jdk17') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
    if ($jdk) { $JdkPath = $jdk.FullName }
}
if (!$JdkPath) {
    $compiler = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($compiler) { $JdkPath = Split-Path -Parent (Split-Path -Parent $compiler.Source) }
}
$java = if ($JdkPath) { Join-Path $JdkPath 'bin\java.exe' }
$javac = if ($JdkPath) { Join-Path $JdkPath 'bin\javac.exe' }
$javaReady = $false
if ($java -and (Test-Path $java) -and (Test-Path $javac)) {
    $version = (& $javac -version 2>&1 | Out-String).Trim()
    $javaReady = $version -match '^javac 17(?:\.|$)'
    Write-Host $version
}
$sdkManager = Join-Path $SdkPath 'cmdline-tools\latest\bin\sdkmanager.bat'
if (!(Test-Path $sdkManager)) {
    $installed = Get-ChildItem (Join-Path $SdkPath 'cmdline-tools') -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\sdkmanager.bat') } | Select-Object -First 1
    if ($installed) { $sdkManager = Join-Path $installed.FullName 'bin\sdkmanager.bat' }
}
Write-Host "JAVA_HOME: $env:JAVA_HOME"
Write-Host "ANDROID_HOME: $env:ANDROID_HOME"
Write-Host "Detected JDK: $JdkPath"
Write-Host "Detected SDK: $SdkPath"
$checks = [ordered]@{
    'Node.js' = [bool](Get-Command node.exe -ErrorAction SilentlyContinue)
    'npm' = [bool](Get-Command npm.cmd -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $root '.npm-cache\npm.cmd'))
    'JDK 17' = $javaReady
    'SDK Manager' = Test-Path $sdkManager
    'Platform tools / ADB' = Test-Path (Join-Path $SdkPath 'platform-tools\adb.exe')
    'Android platform 36' = Test-Path (Join-Path $SdkPath 'platforms\android-36\android.jar')
    'Build tools 36.0.0' = Test-Path (Join-Path $SdkPath 'build-tools\36.0.0\aapt2.exe')
    'NDK 27.1.12297006' = Test-Path (Join-Path $SdkPath 'ndk\27.1.12297006\source.properties')
    'CMake 3.22.1' = Test-Path (Join-Path $SdkPath 'cmake\3.22.1\bin\cmake.exe')
    'Gradle wrapper' = (Test-Path (Join-Path $root 'apps\mobile\android\gradlew.bat')) -and (Test-Path (Join-Path $root 'apps\mobile\android\gradle\wrapper\gradle-wrapper.jar'))
}
foreach ($check in $checks.GetEnumerator()) {
    $state = if ($check.Value) { 'OK' } else { 'MISSING' }
    Write-Host ("{0,-28} {1}" -f $check.Key, $state)
}
if ($checks.Values -contains $false) {
    Write-Host 'See docs/deployment/windows-android-setup.md for the official installation commands.'
    exit 1
}
