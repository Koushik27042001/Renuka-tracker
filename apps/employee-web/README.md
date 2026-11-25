# Renuka FieldForce employee web app

A React and TypeScript PWA for employees. The forest-and-sand design system lives in `src/styles.css`. `main.tsx` owns the responsive navigation and session, `auth.tsx` handles sign-in and one-time links, `pages.tsx` and `visits.tsx` implement employee workflows, and `api.ts`, `device.ts` and `offline.ts` isolate service and browser integrations.

## Local development

From the repository root:

```sh
npm ci --include=dev
npm run build -w @renuka/shared
npm run dev -w @renuka/employee-web
```

Run the API separately. The frontend uses `http://localhost:5174` and proxies `/api` to `http://localhost:3000`. Override the dev or preview API destination with `RENUKA_API_ORIGIN` in this workspace. Add the exact development and preview browser origins, without trailing slashes, to the API's `EMPLOYEE_WEB_ORIGINS`. Local HTTP requires the API's development cookie settings.

```sh
npm run lint -w @renuka/employee-web
npm run typecheck -w @renuka/employee-web
npm run test -w @renuka/employee-web
npm run build -w @renuka/employee-web
```

Use `npm exec -w @renuka/employee-web -- vite preview` to verify the generated service worker and manifest on localhost.

## Vercel and Render

1. Deploy the updated API to the existing Render service. Set `EMPLOYEE_WEB_ORIGINS` to the exact HTTPS employee frontend origin or approved origins, comma separated. Retain the existing admin origins. Keep secure cookies enabled. Set the approved geocoder URL and user agent if full mapped addresses are needed.
2. Create a Vercel project with Root Directory `apps/employee-web`, Node.js 24 and the Vite framework. Enable access to files outside the root directory for npm workspaces, the root lockfile and the shared package. The tracked `vercel.json` configures build, output and SPA routes.
3. The tracked same-origin `/api` rewrite targets the existing Render service; update its destination only if the service hostname changes. Browser login sends the `employee-web` transport and uses a separate HttpOnly cookie. Verify the production response has a secure `__Host-renuka_employee_refresh` cookie on the Vercel origin and the access token only in memory.
4. Administrators still issue activation and reset links through the existing admin workflow. Employees can redeem the original link and then sign in here. This app also supports `/account/setup#token=...` with the same one-time token. Share links through the organization's approved channel.

## Browser workflows and limits

- Workbox precaches only the public application shell, icons, and local fonts. There is no runtime API, private photo or credential cache. A service worker update requires confirmation and is disabled on data-entry, attendance-submission and capture routes.
- IndexedDB retains text visit drafts for up to 12 hours after a failed network save while an active shift is already loaded. The queue is keyed by authenticated employee and visit idempotency key. Synchronization retries the original create request while the app is open and validates with the API. A closed or expired shift can block creation. Clear terminal failures from the queue and create a new eligible draft. Signing out preserves that employee's drafts for their next sign-in. Use a trusted device for local drafts.
- Authentication after a full reload requires a connection. Check-in, check-out, GPS selfie upload and visit submission require live server verification. Offline photo capture and background synchronization are unavailable in this PWA. The APK continues to use its own offline workflow.
- Reports and review notifications summarize the employee's own recent records. The API has no employee push inbox, self-service reset email, or public registration. Reset is invitation-based. Review notifications are in-app only.
- Test on physical Android Chrome and iOS Safari in browser and installed modes. Check invitation redemption, cookie restoration and logout, precise GPS permissions, front-camera selection and release, selfie upload and watermark readability, reconnection and duplicate-safe draft synchronization, installation and the update flow. Test permission denial and account switching. Desktop browser and automated checks do not establish physical-device production readiness.
