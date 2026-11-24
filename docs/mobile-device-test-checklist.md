# Physical device release checks

Record the build, date, device model, OS, test employee, request ID where available, and result for each run. Use staging and an approved test account.

| Test | Android | iOS |
| --- | --- | --- |
| Clean install, sign in, restore and sign out | NOT_TESTED | NOT_TESTED |
| Verify an in-place update preserves an encrypted queue | NOT_TESTED | NOT_TESTED |
| Deny GPS or camera, then allow access from Settings | NOT_TESTED | NOT_TESTED |
| Check in and out using foreground GPS | NOT_TESTED | NOT_TESTED |
| Capture and review a private watermarked image online | NOT_TESTED | NOT_TESTED |
| Capture in airplane mode after online check-in | NOT_TESTED | NOT_TESTED |
| Kill the app and reopen offline to verify queue persistence | NOT_TESTED | NOT_TESTED |
| Resume a multipart upload after connection loss and verify one server visit | NOT_TESTED | NOT_TESTED |
| Verify queued drafts are hidden after switching accounts | NOT_TESTED | NOT_TESTED |
| Verify expired capture policy and reauthentication with a retained queue | NOT_TESTED | NOT_TESTED |
| Confirm local evidence is removed after successful submission | NOT_TESTED | NOT_TESTED |
| Verify approved update URL and required-update behavior | NOT_TESTED | NOT_TESTED |
| Validate foreground-only location and app-private storage on the release build | NOT_TESTED | NOT_TESTED |

Record a separate execution row for each scenario with the build version, device model and OS, test date, approved test employee, request ID, expected result, actual result, and PASS, FAIL, BLOCKED or NOT_TESTED.
