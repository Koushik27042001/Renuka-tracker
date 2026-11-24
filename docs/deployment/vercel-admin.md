# Vercel admin

Import the repository and choose `apps/admin` as the project root. Enable access to source files outside that directory for workspace packages. Choose Node.js 22.x and leave the build overrides to the checked-in `vercel.mjs`.

Set `RENDER_API_ORIGIN` in Vercel to the corresponding Render HTTPS origin without a trailing slash. Keep Vercel's system environment variables exposed to the build so it can select relative API URLs. The dashboard calls `/api` on its own origin and Vercel forwards it to Render. Mobile builds continue to call Render directly.

Set Render's `ADMIN_ORIGINS` to the exact HTTPS dashboard origin. Use a separate staging API and an explicitly allowed stable staging dashboard hostname if previews need authentication. Verify `/api/health/ready` through Vercel, sign in and reload a protected route, then verify sign-out, private evidence and CSV downloads. Confirm the refresh cookie is Secure, HttpOnly and host-only, and API responses are never cached.

[Programmatic Vercel configuration](https://vercel.com/docs/project-configuration/vercel-ts)
