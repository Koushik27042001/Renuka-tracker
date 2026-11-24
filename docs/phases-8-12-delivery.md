# Phases 8–12 delivery

| Area | Files and verification |
| --- | --- |
| Encrypted queue and foreground sync | Mobile `offlineStore.ts`, `offlineSync.ts`, `offlineQueueEvents.ts`, `OfflineQueue.tsx`, `api.ts`, `App.tsx`, `attendanceScreens.tsx`, `visits.tsx`, `MobileVisitSummary.tsx`. Tested retry, ownership and foreground boundaries using mocked native interfaces. Physical SQLite, camera and Keychain validation is tracked separately. |
| Historical evidence and replay | API `offlinePolicy.ts`, `visit.service.ts`, `visit.model.ts`, `config.ts`, `cleanupEvidence.ts` and the shared visit contract. Added optional persisted fields for offline capture binding, the original checksum, evidence delay and review information, and request fingerprints. Existing unique employee/draft-key and visit indexes continue to enforce replay rules. The optional schema fields apply to new writes and legacy documents remain readable. |
| Application release and metrics | API `releases.ts`, `app.ts` and `openapi.json`. The version policy reports only configured public information. Metrics use a separate bearer credential. The branded release page generates a QR code for the configured download page, which may link to a company-authenticated artifact host. |
| Admin and employee UI | Admin `main.tsx`, `AnalyticsDashboard.tsx`, and `FieldVisitsPage.tsx`. Mobile `release.tsx`, `App.tsx`, queue and attendance screens. Uses real APIs and private local storage. |
| Native build configuration | Mobile `config.ts`, `babel.config.js`, Android `app/build.gradle`, iOS `check-release.sh` and Xcode project, mobile `.env.example`. Export the release variables and use approved signing inputs. |
| Environment and operations | Root `render.yaml`, API `.env.example`, workspace manifests and lockfile, [deployment](deployment/overview.md), [operations monitoring](operations/production-monitoring.md), and the [launch checklist](production-launch-checklist.md). |
| Regression tests | API `offlinePolicy.test.ts` and `fieldVisits.test.ts`, mobile `offlineSync.test.ts`, `offlineStore.test.ts`, and `attendance.test.ts`. The browser harness builds and serves the production dashboard against the isolated API fixture. See the launch checklist for observed results and the [physical device matrix](mobile-device-test-checklist.md). |

## Release dependencies

Provision isolated production Atlas and Cloudinary resources, controlled Render and Vercel projects, and company HTTPS domains. Approve offline evidence policy, retention, backup objectives, map tiles and geocoding. Supply the approved signing and publishing identities through each platform’s secret environment, publish the signed artifacts, and record staging and physical-device results before promotion.
