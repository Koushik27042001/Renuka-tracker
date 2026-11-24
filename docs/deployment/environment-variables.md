# Release environment variables

Use [the Render Blueprint](../../render.yaml) or [the manual Render environment template](../../apps/api/.env.render.example) for the production API. The API's `.env.example` is for local development. Set the production Atlas URI, JWT access signing secret, exact HTTPS admin origins and private Cloudinary credentials on Render. Refresh tokens are opaque and stored as hashes. Optional provider credentials stay on the API. Use the admin and mobile `.env.example` files for their respective builds.

Set RENDER_API_ORIGIN on Vercel to the Render HTTPS origin. The hosted admin uses a same-origin API rewrite. VITE_API_URL is used by local and self-hosted builds. Configure approved map settings separately. Mobile builds receive their public HTTPS API origin and release version from exported build environment variables. Keep keystore credentials in a protected build environment.

The release page and update policy require approved HTTPS origins, signed artifact URL, date, SHA-256, support contact and platform versions. Set a separate random token for Prometheus if metrics collection is enabled. Initially disable offline evidence in production pending the company’s approval.

Set both offline flags to enable delayed evidence after company approval. The upload window defaults to 24 hours. Foreground retry defaults to eight automatic attempts with a separate manual retry action. Keep enhanced review enabled for offline uploads. Captures outside the ordinary five-minute window always require enhanced review.
