# Phase 2 — Backend foundation

Renuka Tracker uses one Express API for the admin dashboard and employee mobile app. It opens a single Mongoose connection, verifies the required identity indexes and initializes Argon2id before listening. The MongoDB driver reconnects after transient failures. During a disconnection, readiness and application requests return HTTP 503. On SIGINT or SIGTERM, the server stops accepting requests, drains open requests and closes MongoDB.

## Set up MongoDB Atlas and run locally

1. Use Node 24 LTS. From the repository root, run `npm ci`.
2. In Atlas, create a cluster and a database user for the application database. Allowlist your development IP and the deployment service's outbound IPs or configure private networking. Get the Node.js driver connection string, set an explicit database name such as `renuka_tracker`, and percent-encode special characters in the database credentials. Use a separate database and user per environment. [Atlas connection instructions](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/)
3. In PowerShell, run `Copy-Item apps/api/.env.example apps/api/.env`. Set `MONGODB_URI` and `JWT_ACCESS_SECRET`. Generate the signing secret using `node -p "require('node:crypto').randomBytes(48).toString('base64url')"`. Store it in a secret manager for deployed environments. Local host and port defaults preserve both Phase 1 clients.
4. Run `npm run build:api` and `npm run db:indexes -w @renuka/api`. The index command only creates declared indexes. Resolve conflicting or duplicate data before retrying. Use index-management credentials for this command and keep them out of the web service environment.
5. Inject the protected variables `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PHONE` and optionally `BOOTSTRAP_ADMIN_CODE` into a one-time shell or job. Use a randomly generated password of at least 12 characters and a phone number in E.164 format. Run `npm run admin:create -w @renuka/api`. The script refuses a second super admin, including concurrent bootstrap attempts. Remove the temporary bootstrap secrets from the shell or job when it exits.
6. Run `npm run dev:api`. To run the compiled server, use `npm run build:api` and `npm run start:api`. Open Swagger UI at `http://localhost:3000/api/docs` in development. To try the browser auth flow from Swagger UI, also allowlist the UI origin `http://localhost:3000` in your local API configuration.

The full [environment template](../apps/api/.env.example) lists control settings, including database timeouts, Argon2id parameters, rate limits, cookie flags and trusted proxy CIDRs. The server reports invalid configuration by variable name.

## Collections and indexes

| Collection | Stored data and indexes |
| --- | --- |
| `users` | Profile, Argon2id hash, account status, role and session version. Unique indexes on normalized email and employee code. A partial unique index serializes the initial super-admin creation. A compound role/status index supports account lookups. |
| `refresh_sessions` | Session family ID, user ID, transport, SHA-256 token digests, current rotation count, revocation and expiry. The user/version/revocation index supports logout-all. The expiry TTL index cleans up expired sessions. |
| `audit_logs` | Structured security events, IDs, IP address, normalized user-agent family, and allowlisted metadata. Actor/time and action/time indexes support review. The timestamp TTL index retains events for 90 days. |

MongoDB runs TTL deletions asynchronously. Authentication checks session expiry at request time. The app writes audit records through an append-only service. In production use a custom Atlas role with insert/read access to audit records and the required read/write access to users and sessions. Grant the runtime account permission to list indexes for startup checks. Restrict index creation to the migration operator.

## Authentication and RBAC

| Endpoint | Request and access |
| --- | --- |
| `POST /api/v1/auth/login` | Employee code or email in `identifier`, plus `password`. Returns access token and profile. |
| `POST /api/v1/auth/refresh` | Current refresh credential. Returns a fresh access token and rotates the refresh credential. |
| `POST /api/v1/auth/logout` | Current refresh credential. Revokes that family and its access tokens. Browser requests clear the cookie. |
| `POST /api/v1/auth/logout-all` | Bearer JWT. Increments the account version and revokes sessions from earlier versions. Browser requests clear the cookie. |
| `GET /api/v1/auth/me` | Bearer JWT. Returns the authenticated user's public profile. |
| `GET /api/v1/admin/access` | Bearer JWT for an `ADMIN` or `SUPER_ADMIN`. |
| `GET /api/v1/admin/audit-logs?page=1&limit=25` | Bearer JWT for a `SUPER_ADMIN`. |
| `GET /api/health`, `/api/health/live`, `/api/health/ready` | Legacy client health, process liveness and database readiness. |

The API signs JWTs with HS256 and verifies signature, issuer, audience, token type and expiration. It checks the active account, current role and version, and the active session from MongoDB on protected requests. Rotation atomically replaces the current digest and retains the used digest in the same document. A replay revokes that family, including any token returned by a concurrent refresh. Sessions expire after a fixed period of up to 30 days and allow up to 4,096 rotations. Clients must serialize refresh calls and sign in again if a rotated credential becomes unavailable.

**Browser admin.** Set `X-Auth-Transport: web` and `credentials: 'include'` on auth POST requests. Use an exact configured origin and a same-site deployment such as `https://admin.example.com` and `https://api.example.com`. Browser mutations require the allowlisted Origin and a custom header that forces preflight across origins. Refresh and logout use an empty body and the browser-managed HttpOnly cookie. The production cookie is host-only, Secure, and SameSite Lax or Strict. Keep the access token in memory and send it as a Bearer token. Use the refresh endpoint to restore a session after reloading.

**Employee mobile.** Send `X-Auth-Transport: mobile` on auth POST requests. Omit Origin and Cookie headers. Login and refresh return `data.refreshToken`; store it in iOS Keychain or Android Keystore-backed storage, and replace it atomically on refresh. Refresh and logout send `{"refreshToken":"..."}` in a JSON body. Use the access token as a Bearer token and clear local credentials on logout or terminal refresh failure.

Both clients send a Bearer token and an empty body for logout-all. Regular auth responses use `{success,message,data}`. Errors use `{success,message,requestId}` with optional field errors. HTTP 429 includes `Retry-After`. Auth responses use `Cache-Control: no-store`.

## Test requests

This browser login example uses PowerShell to build the JSON body from an administrator password already injected into the shell environment.

```powershell
$headers = @{ Origin = 'http://localhost:5173'; 'X-Auth-Transport' = 'web' }
$body = @{ identifier = $env:BOOTSTRAP_ADMIN_EMAIL; password = $env:BOOTSTRAP_ADMIN_PASSWORD } | ConvertTo-Json -Compress
$login = Invoke-RestMethod http://localhost:3000/api/v1/auth/login -Method Post -ContentType application/json -Headers $headers -Body $body -SessionVariable browser
Invoke-RestMethod http://localhost:3000/api/v1/auth/me -Headers @{ Authorization = "Bearer $($login.data.accessToken)" }
Invoke-RestMethod http://localhost:3000/api/v1/auth/refresh -Method Post -Headers $headers -WebSession $browser
Remove-Variable body,login,browser
```

In Postman, use the same headers and cookie jar for the web flow. For mobile, set `X-Auth-Transport: mobile` with cookies disabled, and use a provisioned employee account. [OpenAPI contract](../apps/api/openapi.json)

## Deploy to Render

Create a Node web service from the repository root. Set Node 24, build command `npm ci && npm run build:api`, start command `npm run start:api`, and HTTP health path `/api/health/ready`. Set `NODE_ENV=production`, `HOST=0.0.0.0`, HTTPS admin origins and secrets in Render. Let Render supply `PORT`. Run the database index and admin bootstrap commands in a separate one-time job with appropriate Atlas credentials. Configure the API custom domain on the same site as the admin web app. [Render Express deployment](https://render.com/docs/deploy-node-express-app) · [Render health checks](https://render.com/docs/health-checks)

Set `TRUSTED_PROXY_CIDRS` only after verifying exactly which ingress peers can reach the service and confirming they sanitize forwarding headers. With an empty list, Express uses the socket peer as the request IP. Set per-client rate limits at the trusted ingress when it pools client traffic. The built-in rate limit counters are per process. For multiple API replicas, enforce shared limits at the ingress or use a distributed store. Keep a stable signing secret across replicas and restart all instances together after intentional key rotation. Route audit and operational logs to the appropriate secured sinks, and configure Atlas backups for the deployment tier.

## Verification and Phase 3 integration

Run `npm run lint:api`, `npm run format:check -w @renuka/api`, `npm run test:api`, and `npm run build:api`. Vitest and Supertest use a dedicated local MongoDB process managed by mongodb-memory-server. The first test run may download the MongoDB test binary. Set `MONGOMS_SYSTEM_BINARY` to the absolute path of an existing compatible `mongod` executable to use it for the isolated test process. Tests never read the configured Atlas URI.

Phase 3 can reuse `authenticate`, `authorize`, the strict user schemas and the public serializer. For status changes, role changes and password changes, increment `sessionVersion` in the same user update, revoke earlier sessions, and append a security audit event. Scope ordinary admins to the employee records they are authorized to manage.

See the [backend inventory](../apps/api/README.md) for the Phase 2 files.
