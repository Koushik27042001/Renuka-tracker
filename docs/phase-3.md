# Phase 3 — Employee management

Employees remain in the `users` collection with role `EMPLOYEE`. Phase 3 adds an optional joining date, an employee profile revision, onboarding state and internal setup credential digests. Older records use revision 0 and remain eligible for their existing login flow. The employee counter is a single document in `employee_counters`; first use seeds it from the largest existing numeric EMP code, and atomic increments allocate subsequent codes. Gaps are possible and reserved codes are never recycled.

The index command creates the counter collection, directory indexes, and the employee audit history index. The normal runtime needs read/write access to the counter and the existing Phase 2 collection permissions. Directory search uses a case-insensitive literal prefix and applies role and department scope. Filters and export use the same query. CSV streams from a MongoDB cursor and neutralizes spreadsheet formula prefixes.

## Run the module

From the root, run the following commands. Use the Atlas and JWT settings described in the [Phase 2 guide](phase-2.md). Run the bootstrap command only when the environment still needs its initial super-admin account.

```sh
npm ci
npm run build:api
npm run db:indexes -w @renuka/api
npm run admin:create -w @renuka/api
```

Start `npm run dev:api` and `npm run dev:admin` in separate terminals. Open `http://localhost:5173/employees` and sign in with your administrator account. For hosted static frontends, configure the SPA fallback to `index.html` so links to employee pages and account setup load directly. Host the admin frontend and API on the same HTTPS site for the existing cookie transport.

## Roles and credentials

SUPER_ADMIN can manage every employee and view employee-specific audit history. ADMIN can manage employee records whose department exactly matches the authenticated administrator's department. All employee queries enforce the same scope and never target administrators. A scoped administrator cannot move a profile into a different department. EMPLOYEE retains the Phase 2 self-profile API.

New employees start inactive and pending onboarding. After creating the profile, select **Issue activation link** on its profile and share the link through an approved secure channel. Its token is carried in a URL fragment, cleared from browser history on opening, and submitted in the account-setup request body. The explicit issuance endpoint returns the credential once. List, detail, update, audit and export responses never include it. The server stores only a digest, expires it after 30 minutes and consumes it atomically. Issuing a new link replaces the previous one. No email provider is required.

The same link-issuance workflow supports password resets for active employees. Redemption sets the new Argon2id hash, consumes the link, and invalidates prior sessions. Status changes increment the existing session version and revoke earlier refresh families. Suspension and deactivation require a reason. Account records remain available for historical references. Employee profile revisions prevent stale writes. Audit events retain changed field names without their previous or new values.

## API

Employee management endpoints require Phase 2 administrator Bearer authentication. Account setup redemption uses the one-time credential. Detail, update, status and setup-token issuance return 404 for employees outside the caller's scope. Update and status accept the last known `revision` and return 409 on a conflict.

| Method and path | Contract |
| --- | --- |
| POST `/api/v1/employees` | Profile fields. Returns 201 with the newly created employee. |
| GET `/api/v1/employees` | Page, limit, search, department, designation, status, sortBy, sortOrder. |
| GET `/api/v1/employees/:id` | Employee detail, status, dates and revision. |
| PATCH `/api/v1/employees/:id` | Allowed profile changes and revision. Empty joining date clears it. |
| PATCH `/api/v1/employees/:id/status` | Status, reason when required, and revision. |
| POST `/api/v1/employees/:id/password-reset` | Explicit activation or reset link issuance. Returns one-time token and expiry. |
| POST `/api/v1/auth/account-setup` | Public, rate-limited redemption with token and new password. |
| GET `/api/v1/employees/stats` | Scoped counts and department options. |
| GET `/api/v1/employees/export` | Same filters and sorting as list, streamed as CSV. |
| GET `/api/v1/employees/:id/audit-logs` | SUPER_ADMIN only, with page and limit. |

See the [OpenAPI contract](../apps/api/openapi.json) and development Swagger UI at `/api/docs`.

## Verify

Run `npm run test:api`, `npm run test:admin`, `npm run lint:api` and `npm run build`. The backend tests use isolated MongoDB. The admin tests render components and exercise workflows against controlled API responses. Run `npm run test:e2e` to launch a real browser, Express, Vite and a fresh local MongoDB and exercise the end-to-end workflow. Windows uses installed Microsoft Edge by default. Set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome, or install Chromium with `npm exec -w @renuka/admin -- playwright-core install chromium` on other platforms. Use `MONGOMS_SYSTEM_BINARY` to select an existing local MongoDB test executable.

1. Create an employee, check the generated ID, and confirm the list and counts update.
2. Try the same normalized email again. Check that the form shows the server error.
3. Issue an activation link, redeem it in a separate tab, and confirm the employee can log in via the mobile auth API.
4. Edit profile fields, then attempt a stale edit from a second tab. Check for a conflict.
5. Suspend or deactivate the employee with a reason. Confirm existing tokens fail.
6. Sign in as a department ADMIN and check that list, detail, stats, and export stay in scope.
7. Export filtered CSV and inspect the employee audit history as SUPER_ADMIN.
8. Open the admin directory at a narrow viewport and check keyboard navigation and horizontal scrolling.

## Files and Phase 4

- `packages/shared/src/employees.ts` defines the shared inputs and response types. `packages/shared/src/index.ts` exports them.
- `apps/api/src/modules/employees/` includes the repository, service, validation and routes. `EmployeeCounter.model.ts` adds the atomic code counter. The existing model registry, User and AuditLog models, app routing, audit writer, and auth context were extended.
- `apps/admin/src/` contains the authenticated API client, auth pages, session provider, layout, employee list, form and profile screens. Files include `api.ts`, `AuthPages.tsx`, `session.tsx`, `main.tsx`, `styles.css`, `EmployeesPage.tsx`, `EmployeeForm.tsx`, and `EmployeeProfile.tsx`. `apps/admin/vercel.json` configures Vercel SPA and API rewrites.
- `apps/api/test/employees.test.ts` and `apps/admin/test/employees.test.tsx` cover the API and UI. `apps/admin/test/employee-browser.mjs` drives the full workflow. The workspace and CI scripts run the new tests. Dependency changes live in the admin package and root lockfile.

Phase 4 can link attendance to the immutable employee database ID, use the verified employee identity and active-session checks, and render attendance history on the existing profile when its API is available.
