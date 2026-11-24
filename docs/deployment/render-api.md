# Render API

Connect this repository as a Blueprint using [render.yaml](../../render.yaml). The service runs the workspace build, applies indexes in the paid pre-deploy step, and serves readiness at /api/health/ready. Automatic deployment is disabled so the operator can promote a verified revision explicitly. Review the plan and region before provisioning. Use the Render environment dashboard for credentials.

Confirm Atlas reachability from Render, configure proxy trust only from verified provider boundaries, and set ADMIN_ORIGINS to the exact Vercel dashboard origin. Supply the Render HTTPS origin as RENDER_API_ORIGIN in Vercel. Verify the dashboard can refresh its session and that logs show request IDs. Keep the service isolated from production until staging gates pass.
