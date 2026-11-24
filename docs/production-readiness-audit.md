# Production-readiness audit

Inspected the npm workspaces, shared Zod contracts, Express routes and security middleware, MongoDB indexes, Sharp and Cloudinary integration, admin routes, mobile navigation, Android Gradle, iOS Podfile and permission declarations, environment templates, isolated test fixtures, API contract, and Phase 2, 4 and 5–7 guides. The two final prompt attachments have identical SHA-256 hashes.

| Feature | Starting status | Required action | Priority |
| --- | --- | --- | --- |
| Authentication | Argon2id, rotating refresh sessions, department authorization, host-only admin cookies and server-side revocation. Mobile restoration requires a network round trip. | Preserve online authorization and isolate local data across sign-ins. | Critical |
| Attendance | Server-confirmed UTC timestamps, business-day reporting, MongoDB uniqueness and event-triggered location. | Keep attendance online and verify regression tests. | Critical |
| GPS selfie | Camera bridge and private, server-watermarked storage tested in components and via API, Cloudinary and browser. | Physical Android and iOS camera/GPS verification. | Critical |
| Visit review | Atomic pending-to-reviewed transition, scoped evidence and tracked review decisions. | Display delayed-device timestamp risk and preserve review history. | Critical |
| Offline synchronization | Temporary camera file and in-memory upload only. Draft and evidence APIs require an active live shift. Draft replay originally returned an existing record without comparing its payload. | Encrypt durable queue and photo storage, enforce idempotency and attendance-window checks for delayed capture. | High |
| Security and operations | Liveness/readiness, sanitized request logging, private evidence and a dry-run cleanup CLI. No scrape endpoint or durable cleanup-job status. | Add opt-in metrics, cleanup verification and incident procedures. | Critical |
| Production deployment | Vite SPA rewrites exist. Atlas and Cloudinary were previously verified with configured development credentials. | Prepare service configs. Hosting, domains, backups, monitoring and approved providers require operator access. | Critical |
| Android release | Foreground permissions and release variant exist. API URL is empty for release, and release signing is unset. | Configure signing and versioning, provide a protected-distribution handoff, run the Gradle release task. | Critical |
| iOS distribution | CocoaPods project and foreground permission strings exist. Release distribution and physical devices were previously unverified. | Prepare release configuration and document macOS signing and distribution gates. | High |
| Admin and mobile polish | Analytics, visits, attendance and employee workflows exist. Settings are minimal and there is no app-update flow. | Integrate real profile, release information, recent activity and the offline queue. | High |

Prior Phase 5–7 results are historical evidence only. Release PASS requires a fresh result for the current code and, where applicable, the actual signed artifact and deployment target.
