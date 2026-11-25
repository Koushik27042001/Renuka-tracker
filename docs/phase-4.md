# Phase 4 — Attendance

## Run locally

Run `npm ci`, `npm run build:api` and `npm run db:indexes -w @renuka/api` from the root. The API verifies required attendance indexes at startup. Start `npm run dev:api` and `npm run dev:admin` in separate terminals. Open `http://localhost:5173/attendance`. Use the [Phase 2 guide](phase-2.md) for Atlas setup and administrator bootstrap.

For Android, use the SDK, NDK and JDK described in the [Phase 1 guide](phase-1.md). Run `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:8081 tcp:8081`, then `npm run start -w @renuka/mobile` and `npm run android -w @renuka/mobile -- --no-packager`. For iOS, run `bundle install` in `apps/mobile` and `bundle exec pod install` in `apps/mobile/ios` on macOS, then start Metro and run `npm run ios -w @renuka/mobile -- --no-packager`. Signed releases use the HTTPS `releaseApiUrl` in `apps/mobile/config.ts`.

| Setting | Default |
| --- | --- |
| `BUSINESS_TIMEZONE` | `Asia/Kolkata` |
| `ATTENDANCE_PREFERRED_ACCURACY` | 20 metres |
| `ATTENDANCE_MAX_ACCURACY` | 100 metres |
| `ATTENDANCE_MAX_LOCATION_AGE_SECONDS` | 30 |
| `ATTENDANCE_MAX_SHIFT_HOURS` | 24 |

## Attendance lifecycle

Server UTC time controls check-in, checkout and working minutes. GPS timestamps are stored separately. The local check-in date stays with the record across an overnight shift. Checkout is counted on the local date it occurs. MongoDB stores each GeoJSON point as longitude then latitude.

A partial unique index enforces one active session per employee. Two further unique indexes scope request keys by employee and attendance action. Reusing the same UUID and payload returns the existing record, including after the fix ages. Reusing the key with different content returns HTTP 409. Checkout from the mobile app uses the active attendance ID, which protects a newer session from a delayed retry. The app retains uncertain submissions on the active screen and reconciles the current session from the server after restart. Persistent offline submissions are part of Phase 8.

Open sessions older than the maximum shift duration are reported as incomplete. A new check-in persists that incomplete state before creating a new session. Incomplete sessions receive no credited minutes or checkout location. Statistics count distinct employees for on-duty and checkout-today cards. The not-checked-in card counts active employees without today's check-in, an ongoing shift, or today's checkout. Incomplete counts cover all available records. Summary cards are independent of the table filters.

Employees can access their own records. ADMIN reports and exports use the employee's current department, and SUPER_ADMIN can see all departments. GPS coordinates appear on authorized detail screens. Reports, general logs and CSV avoid coordinates. Android uses precise and coarse foreground permissions, and iOS displays the when-in-use permission prompt. Location is requested only from the explicit capture button. The working timer updates from server time while focused and refreshes the server snapshot on resume. Mobile refresh credentials use Keychain or Keystore-backed storage.

## API

Use Bearer authorization and request JSON for attendance submissions. The submission shape includes the `idempotencyKey` UUID and `location` with latitude, longitude, accuracy in metres and UTC ISO capturedAt. Checkout accepts optional `attendanceId`. See [OpenAPI](../apps/api/openapi.json) for request parameters and responses.

| Method and path | Purpose |
| --- | --- |
| POST `/api/v1/attendance/check-in` | Employee check-in, HTTP 201 for new and 200 for replay. |
| POST `/api/v1/attendance/check-out` | Employee checkout and server duration. |
| GET `/api/v1/attendance/me/current` | Business date, server clock, GPS limits and current session. |
| GET `/api/v1/attendance/me/history` | Own sessions with pagination and optional dates. |
| GET `/api/v1/attendance/me/:id` | Own session detail. |
| GET `/api/v1/attendance` | Scoped report with search, department, date range, status, employee, sorting and pagination. |
| GET `/api/v1/attendance/stats` | Scoped summary. |
| GET `/api/v1/attendance/:id` | Scoped detail with GPS points. |
| GET `/api/v1/attendance/export` | Scoped CSV with report filters and sorting. |

## Verification and hand-off

Run `npm run test:api`, `npm run test:admin`, `npm run test:mobile`, `npm run test:e2e`, `npm run lint:api` and `npm run build`. API and browser tests use isolated MongoDB. Mobile tests exercise mocked platform bridges and transport. Verify the permission prompts, unavailable location, timeout and app resume on physical Android and iOS devices before release. Device location is a client-provided reading and can be manipulated on a compromised device.

1. Sign in as an employee, capture a fix and confirm check-in. Check the clock and reopen the app to verify the existing shift.
2. Temporarily drop connectivity during confirmation, reconnect and retry the same submission. Confirm one attendance row.
3. Check out across midnight and verify the check-in date, checkout date and elapsed minutes.
4. Inspect filters and download CSV as a scoped admin. Check that another department's record is inaccessible.
5. Open both recorded locations in Maps. Test denied, approximate and unavailable location scenarios.

File inventory:

- New shared `packages/shared/src/attendance.ts` and barrel export.
- New API `apps/api/src/modules/attendance/` with model, validation, service and routes. Extended API app and server, model registry, employee CSV helper, audit model and writer, environment configuration and OpenAPI. New `apps/api/test/attendance.test.ts`.
- New admin `AttendancePage.tsx`, `attendance.api.ts` and `test/attendance.test.tsx`. Updated layout routes, API client, employee profile, styles and browser integration.
- Mobile `App.tsx`, new `src/api.ts`, `src/attendanceScreens.tsx`, `src/attendanceTime.ts`, `src/foregroundLocation.ts` and `test/attendance.test.ts`. Updated Android manifest, Android activity and iOS permission description.
- Updated package manifests, lockfile, CI checks and root README.

Phase 5 can associate a visit with the active session using the authenticated employee ID and attendance ID. Each visit should capture its own foreground fix after the employee explicitly starts the visit action.
