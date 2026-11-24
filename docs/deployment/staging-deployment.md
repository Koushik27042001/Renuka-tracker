# Isolated staging deployment

Use the existing root Render Blueprint as the API template and create a separate staging service after operator approval. Use a dedicated Atlas database and user and a dedicated Cloudinary environment or restricted staging media folder. Configure `MONGODB_URI`, `JWT_ACCESS_SECRET`, `CLOUDINARY_URL`, `CLOUDINARY_FOLDER`, `ADMIN_ORIGINS` and the verified `TRUSTED_PROXY_CIDRS`. Keep `COOKIE_SECURE=true` and use HTTPS with the Vercel same-origin API rewrite. Keep staging offline evidence disabled until the company approves its use.

| Render setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build:api` |
| Pre-deploy command | `npm run db:indexes -w @renuka/api` |
| Start command | `npm run start:api` |
| Readiness path | `/api/health/ready` |

Create a dedicated Vercel project with `apps/admin` as its root and enable access to files outside the project directory. Apply the build and SPA settings in [Vercel admin](vercel-admin.md). In the staging deployment branch, point the `/api` rewrite in `apps/admin/vercel.json` at the staging HTTPS API origin. Set `MOBILE_API_URL` to the same origin before starting Metro or building the signed APK. Export only the public origin to the mobile app.

Verify HTTPS readiness, the scopes of the bootstrap account and test employees, CORS, browser refresh and direct navigation to protected routes. Then exercise the private photo workflow and authorized evidence access with staging accounts. Record actual results in the launch checklist.
