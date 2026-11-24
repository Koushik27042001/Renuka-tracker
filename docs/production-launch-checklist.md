# Production launch checklist

| Item | Status | Evidence or dependency |
| --- | --- | --- |
| Production Atlas indexes and connectivity | BLOCKED | Requires provisioned production database and Render network access |
| Render deployment and readiness | BLOCKED | Requires company Render account and approved API hostname |
| Vercel deployment and secure session refresh | BLOCKED | Requires company Vercel project and admin hostname |
| Production Cloudinary private evidence | BLOCKED | Requires scoped production credentials and provider verification |
| Offline evidence approval | BLOCKED | Requires company delay, review, and device policy approval |
| Signed Android installation and upgrade | BLOCKED | Requires company signing identity, distribution URL and test devices |
| iOS archive and device validation | BLOCKED | Requires macOS, Apple signing identity and test devices |
| Device permission, GPS accuracy, and offline recovery | NOT_TESTED | Perform using signed Android and iOS devices |
| Backup restore and incident rehearsal | BLOCKED | Requires isolated production-like restore destination and operator |

## Local verification

| Check | Status | Evidence |
| --- | --- | --- |
| API regression suite | PASS | 37 tests using an isolated MongoDB instance, including delayed upload, replay, checksum rejection, and submission after checkout |
| Release page, version policy, and metrics | PASS | Local HTTP tests verified the QR page, release origin restrictions and bearer-protected scrape |
| Admin unit suite | PASS | 14 tests |
| JavaScript build and validation | PASS | API and admin build, mobile typecheck, API lint and formatting |
| Android and iOS JavaScript release bundles | PASS | Metro generated both platform bundles with an HTTPS release API origin |
| Configured Atlas and Cloudinary connections | PASS | Read-only Atlas and authenticated Cloudinary ping using the existing development settings |
| Android Windows toolchain | PASS | Verified JDK 17, Gradle 9.3.1, SDK 36, Build Tools 36.0.0, CMake 3.22.1 and NDK 27.1.12297006 |
| Android debug APK | NOT_TESTED | Gradle reached native compilation. Verify the APK and its signature before installation |
| iOS native archive | BLOCKED | Requires macOS and Xcode |
| Mobile unit suite | PASS | 11 tests including encryption, owner isolation, temporary-file cleanup, and retry |
| Browser business workflow | PASS | Production dashboard bundle with isolated MongoDB and private test media storage |
| Evidence cleanup dry run | PASS | Configured development Atlas returned zero eligible records. Cleanup apply remains an operator-approved action |
