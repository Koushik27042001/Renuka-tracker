# Phases 5–7 — GPS selfie evidence, visits and analytics

## Run and configure

From the workspace root, run `npm ci`, `npm run build:api` and `npm run db:indexes -w @renuka/api`. Start `npm run dev:api` and `npm run dev:admin` in separate terminals. Sign in and open `/visits` or `/reports`. Use the [Phase 2 guide](phase-2.md) for administrator bootstrap and the [Phase 4 guide](phase-4.md) for Android, iOS and API URL configuration. Keep the API URL and tile configuration environment-specific. Use an HTTPS API origin for signed mobile builds.

| Setting | Purpose |
| --- | --- |
| `CLOUDINARY_URL` | Existing backend-only Cloudinary URL. Alternatively set all three credential fields below. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Separate backend-only Cloudinary credentials. |
| `CLOUDINARY_FOLDER` | Storage namespace, defaults to `fieldforce/evidence`. Use a separate namespace per environment. |
| `GEOCODING_REVERSE_URL` | HTTPS Nominatim-compatible reverse endpoint. Set this and `GEOCODING_USER_AGENT` on the API service to include mapped addresses on new photos. Use an organization-approved provider for employee data. |
| `GEOCODING_USER_AGENT` | Identifying application name and contact information for the provider. Required to enable address requests. |
| `GEOCODING_API_KEY` | Optional Bearer credential for the configured endpoint. |
| `GEOCODING_ATTRIBUTION` | Optional credit printed on the photo when an address is included. Set this for OpenStreetMap data. |
| `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION` | Optional tile URL and its provider attribution. The default uses attribution-bearing OpenStreetMap tiles. |
| Phase 4 GPS and business timezone settings | Existing maximum accuracy, GPS age, maximum shift length and organization time zone apply. |

Cloudinary authenticates the original JPEG asset. The backend requests it with a 60-second signed provider URL and sends the bytes only after checking current authorization. The mobile and browser clients receive neither provider credentials nor a public photo URL. Uploads use HTTPS. Keep maps and geocoding providers consistent with your organization's employee privacy policy and provider terms. Use public Nominatim only for policy-compliant limited development with non-sensitive coordinates. Provide a production tile service for substantial traffic. [Cloudinary authenticated media](https://cloudinary.com/documentation/control_access_to_media) · [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/) · [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)

### Self-hosted address lookup

Choose the OpenStreetMap extract covering your service area. This local Docker Compose example uses eastern India and binds Nominatim to loopback. The first start imports the extract into a persistent volume. [Geofabrik extracts](https://download.geofabrik.de/asia/india/eastern-zone/index.html) · [Nominatim container setup](https://github.com/mediagis/nominatim-docker/blob/master/howto.md)

```powershell
$env:NOMINATIM_PBF_URL = 'https://download.geofabrik.de/asia/india/eastern-zone-latest.osm.pbf'
$env:NOMINATIM_PASSWORD = Read-Host 'Set a Nominatim database password' -MaskInput
docker compose -f compose.geocoding.yaml up -d
docker compose -f compose.geocoding.yaml logs -f nominatim
```

Once the import finishes, use a public landmark to verify the local endpoint.

```powershell
Invoke-RestMethod 'http://127.0.0.1:8088/reverse?lat=22.5448&lon=88.3426&format=jsonv2' |
  Select-Object -ExpandProperty display_name
```

Set these values in `apps/api/.env` and restart the development API.

```dotenv
GEOCODING_REVERSE_URL=http://127.0.0.1:8088/reverse
GEOCODING_USER_AGENT=Renuka Tracker local
GEOCODING_ATTRIBUTION="© OpenStreetMap contributors | https://www.openstreetmap.org/copyright"
```

For Render, host Nominatim on an approved server behind an HTTPS reverse proxy and set the HTTPS `/reverse` URL, identifying user agent, and attribution in the API service environment. Set `GEOCODING_API_KEY` if the proxy expects a Bearer credential. Redeploy the API to include addresses on new uploads. The phone continues to supply the coordinates and accuracy. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)

## Workflow and data

1. An employee signs in and checks in, opens **Field visits**, and saves the client or place, purpose and optional details. The server reserves a collision-safe code from the MongoDB ID and binds the draft to active attendance. Visit date is the current business date.
2. The employee opens **Capture GPS selfie**, grants permissions, uses the camera, and gets one fresh GPS fix on returning to the app. The camera requests the front lens. Device camera implementations can control the default lens. The app has no gallery picker. Camera files are temporary and are deleted when the app can access their file URI.
3. The employee requests **Process and preview watermark**. The API validates the MIME declaration and actual decoded image, auto-orients, resizes and re-encodes it without EXIF. Sharp renders the company, employee code and name, coordinates, accuracy, address status, capture time and visit code into an appended strip in the JPEG pixels. The capture time is recorded from the native camera confirmation. The API checks it against fresh GPS data and stores server upload and submission timestamps separately. Missing provider addresses are shown as unavailable.
4. The server stores the watermarked draft photo in authenticated Cloudinary storage and MongoDB keeps its SHA-256, size, dimensions, IDs, point, timestamps, provider metadata and watermark version. A single embedded Evidence record shares the visit's atomic write boundary. A reported mock-location signal is optional and advisory. The employee previews the stored watermarked original, can remove it and retake, and then submits the visit.
5. The visit moves from DRAFT to PENDING_REVIEW. An ADMIN can review visits in their current department. SUPER_ADMIN can review across departments. Review is one atomic transition to APPROVED or REJECTED. Rejection records reviewer, server time and reason. Employees can read the status after refreshing their visit history. An approval records company acceptance of evidence.
6. Reports aggregate scoped MongoDB records with a default 30-day range and a 366-day maximum. Employee counts are current. On-duty and completed-today metrics use the current business day. Date-range attendance charts group by the session's check-in date and average only completed working durations. Weekly buckets begin on Monday. Recorded locations uses clustered, paginated submitted evidence points.

The capture proximity window follows the configured GPS age. New uploads accept the original capture within five minutes, with a limited allowance for future clock skew. A completed replay with the original key and payload works independently of the new-upload time limit. Draft creation and submission are idempotent. Submitted fields and evidence cannot be edited or replaced through employee or admin routes.

## Permissions, retention and incident recovery

Android declares foreground camera and location permissions. iOS uses camera and when-in-use location usage descriptions. Camera capture and GPS are explicitly initiated. The app sends exact coordinates only as part of evidence processing and, when configured by the operator, an address lookup. Photo data and GPS coordinates are excluded from general request logs. Admin reads of private evidence, upload, review, and export are audited.

Run `npm run evidence:cleanup -w @renuka/api` for a dry-run count. An operator can run `npm run evidence:cleanup -w @renuka/api -- --apply` to recover incomplete upload claims older than 15 minutes, clear photos of discarded drafts, and expire untouched drafts after 48 hours. Add `--retention-days=N` for an approved reviewed-photo retention policy. The command preserves visit status and review history, revokes access to retired photos before deleting them, and retries transient cleanup failures on a subsequent run. Use a consistent Cloudinary folder when recovering claims. The retention command applies only when explicitly invoked with `--apply`.

## Routes and files

The [OpenAPI contract](../apps/api/openapi.json) includes employee draft/list/edit/submit/discard, scoped admin list/stats/review/export, server-mediated multipart evidence upload, authorized image/metadata/hash verification, and analytics overview/attendance/visits/employees/locations/reviews/export.

- `packages/shared/src/visits.ts` and `index.ts` provide shared visit and evidence contracts.
- `apps/api/src/modules/visits/` contains the model, evidence and visit service, and routes. `apps/api/src/integrations/` contains `cloudinary.ts`, `geocoding.ts` and `evidenceImage.ts`. `apps/api/src/modules/analytics/` contains scoped aggregations and routes. API app, server, auth audit writer, audit model, model registry, config, environment template, cleanup script and OpenAPI were extended. Tests live in `apps/api/test/fieldVisits.test.ts` and `browser-server.mjs`.
- `apps/mobile/src/visits.tsx`, `cameraEvidence.ts` and `requestId.ts` provide screens and capture utilities. The mobile API, attendance navigation, GPS helper, app entry point, Android manifest, iOS plist and package were updated. Camera bridge tests live in `apps/mobile/test/cameraEvidence.test.ts`.
- `apps/admin/src/FieldVisitsPage.tsx`, `AnalyticsDashboard.tsx`, `EvidenceMap.tsx` and `field.api.ts` wire reviews, downloads and charts into the workspace. The dashboard router, profile links, styles, environment example, admin tests and browser workflow were updated.
- Workspace manifests and the lockfile register the camera, image processing, storage, map and chart packages.

## Verification

Run `npm run test:api`, `npm run test:admin`, `npm run test:mobile`, `npm run test:e2e`, `npm run lint:api`, `npm run format:check -w @renuka/api` and `npm run build`. Test fixtures for photos, locations, provider responses and the browser database are isolated from production. The browser run covers employee provisioning, check-in, multipart upload, private preview, review, reports and recorded markers. On a physical Android and iOS device, test camera permission, lens, orientation, cancellation, retake, GPS permission and accuracy, upload interruption, temporary-file cleanup, and the out-of-network flow before distribution.

The GPS and image watermark are review evidence and cannot establish physical presence on a modified device. Native store-and-forward is outside these phases. Deploy the admin Vite build as an SPA, run the backend migration before startup, and verify provider credentials and font availability in the target environment. Build a signed Android APK and use TestFlight or the organization's approved iOS distribution process once native checks pass.
