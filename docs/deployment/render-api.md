# Render API

Connect this repository as a Blueprint using [render.yaml](../../render.yaml). For a manually created Node Web Service, leave Root Directory blank and use [the Render environment template](../../apps/api/.env.render.example).

| Render field | Value |
| --- | --- |
| Build Command | `npm ci --include=dev && npm run build:api` |
| Pre-Deploy Command | `npm run db:indexes -w @renuka/api` |
| Start Command | `npm run start:api` |
| Health Check Path | `/api/health/ready` |
| Instance Type | Starter |
| Auto-Deploy | Off |

Enter the following values in the Render dashboard.

- `MONGODB_URI` uses the production MongoDB Atlas database and its service account. Allow the service's Render outbound addresses in Atlas. Use Atlas SRV with TLS and certificate validation.
- `JWT_ACCESS_SECRET` uses a dedicated random value for this environment. Generate it with `node -p "require('node:crypto').randomBytes(32).toString('base64url')"`. Keep the same value across deploys so existing access tokens remain valid until expiry.
- For a manually created service, set `ADMIN_ORIGINS` to the value in the Render environment template. If the dashboard domain changes, update this setting to match the browser's exact HTTPS origin with no trailing slash and deploy the API. Use commas for multiple approved origins.
- `CLOUDINARY_URL` contains the production Cloudinary credential URL for evidence uploads.

Render supplies `PORT`. If you have verified the inbound proxy addresses, set `TRUSTED_PROXY_CIDRS` to those IPs or CIDRs. Keep first-admin credentials scoped to the [one-time bootstrap](../phase-2.md).

Once the readiness endpoint returns HTTP 200, confirm that `apps/admin/vercel.json` points to the Render HTTPS origin and deploy the dashboard. Verify sign-in and session refresh through the dashboard.

If session refresh returns HTTP 403 with the API message `Authentication transport is not permitted`, compare the browser's request `Origin` with the deployed `ADMIN_ORIGINS` value. If the response is a Vercel protection page, open the project's production domain and add that domain to `ADMIN_ORIGINS` before using it. A refresh request without a session cookie returns HTTP 401 when the origin is allowed.
