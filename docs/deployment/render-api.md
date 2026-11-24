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
- `ADMIN_ORIGINS` contains the exact HTTPS dashboard origin with no trailing slash. Use commas for multiple origins.
- `CLOUDINARY_URL` contains the production Cloudinary credential URL for evidence uploads.

Render supplies `PORT`. If you have verified the inbound proxy addresses, set `TRUSTED_PROXY_CIDRS` to those IPs or CIDRs. Keep first-admin credentials scoped to the [one-time bootstrap](../phase-2.md).

Once the readiness endpoint returns HTTP 200, confirm that `apps/admin/vercel.json` points to the Render HTTPS origin and deploy the dashboard. Verify sign-in and session refresh through the dashboard.
