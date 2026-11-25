# Android testing from VS Code

Enable USB debugging on the company-approved Android test phone. Connect it by USB and approve the device prompt. Run these commands from the repository root.

```powershell
adb devices -l
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
adb reverse tcp:3000 tcp:3000
npm run start -w @renuka/mobile
```

After Metro starts, launch the app from the phone or run `adb shell am start -n com.renukatracker/.MainActivity` in a second terminal.

Use the serial with `adb -s <serial>` when several devices are attached. The `device` status confirms authorization. For the hosted API, copy `apps/mobile/.env.example` to `apps/mobile/.env`. The mobile npm scripts load the Render URL from that file. Forward Metro only when using the hosted API. For local debug, clear `MOBILE_API_URL` in that file, start the API on port 3000, and forward both ports. Restart Metro if the API origin changes. A signed release runs independently of Metro.

If an update fails with a signing mismatch, use the company-signed update or an approved test device. Preserve existing device data. For crashes collect `adb logcat -b crash -d` and keep employee details and tokens out of shared logs. Record evidence in the [device test matrix](../mobile-device-test-checklist.md).
