[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$JdkPath,
    [string]$SdkPath = $env:ANDROID_HOME,
    [switch]$InstallPackages
)
$ErrorActionPreference = 'Stop'
if (!$SdkPath) { $SdkPath = $env:ANDROID_SDK_ROOT }
if (!$SdkPath) { $SdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$SdkPath = (Resolve-Path -LiteralPath $SdkPath).Path
$JdkPath = (Resolve-Path -LiteralPath $JdkPath).Path
$javac = Join-Path $JdkPath 'bin\javac.exe'
if (!(Test-Path $javac)) { throw 'Select a JDK directory containing bin\javac.exe.' }
if ((& $javac -version 2>&1 | Out-String) -notmatch 'javac 17(?:\.|\s|$)') {
    throw 'Select a Java 17 JDK.'
}
if ($env:JAVA_HOME -and $env:JAVA_HOME -ne $JdkPath) { throw 'JAVA_HOME already points elsewhere. Use a fresh terminal or update it explicitly.' }
if ($env:ANDROID_HOME -and $env:ANDROID_HOME -ne $SdkPath) { throw 'ANDROID_HOME already points elsewhere. Use a fresh terminal or update it explicitly.' }
if ($env:ANDROID_SDK_ROOT -and $env:ANDROID_SDK_ROOT -ne $SdkPath) { throw 'ANDROID_SDK_ROOT conflicts with the selected SDK.' }
if ($PSCmdlet.ShouldProcess('current PowerShell session', 'Configure JAVA_HOME, ANDROID_HOME and PATH')) {
    $env:JAVA_HOME = $JdkPath
    $env:ANDROID_HOME = $SdkPath
    $newPaths = @((Join-Path $JdkPath 'bin'), (Join-Path $SdkPath 'platform-tools')) |
        Where-Object { $_ -notin ($env:Path -split ';') }
    if ($newPaths) { $env:Path = ($newPaths -join ';') + ';' + $env:Path }
}
if ($InstallPackages) {
    $manager = Join-Path $SdkPath 'cmdline-tools\latest\bin\sdkmanager.bat'
    if (!(Test-Path $manager)) { throw 'Install the official Android command-line tools in cmdline-tools\latest first.' }
    $packages = [ordered]@{
        'platform-tools' = 'platform-tools/adb.exe'
        'platforms;android-36' = 'platforms/android-36/android.jar'
        'build-tools;36.0.0' = 'build-tools/36.0.0/aapt2.exe'
        'ndk;27.1.12297006' = 'ndk/27.1.12297006/source.properties'
        'cmake;3.22.1' = 'cmake/3.22.1/bin/cmake.exe'
    }
    $missing = @($packages.GetEnumerator() | Where-Object {
        !(Test-Path (Join-Path $SdkPath $_.Value))
    } | ForEach-Object { $_.Key })
    if ($missing.Count -and $PSCmdlet.ShouldProcess($SdkPath, 'Install missing Android SDK packages')) {
        & $manager "--sdk_root=$SdkPath" --install @missing
        if ($LASTEXITCODE) { throw 'SDK installation failed. Check SDK Manager output and any outstanding license prompts.' }
    }
}
Write-Host 'Run scripts/check-android-environment.ps1 before building.'
