# Phase 1 — Monorepo setup

Use Node 24 LTS and npm. The Express API, Vite admin, and React Native CLI app are independent workspaces. The shared package publishes compiled JavaScript and TypeScript declarations inside the workspace so Express, Vite, and Metro consume the same Zod schemas and HTTP client.

## Workspace layout

```text
.
├── .github/workflows/checks.yml
├── apps/
│   ├── admin/
│   │   ├── .env.example
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── src/{main.tsx,styles.css}
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   ├── api/
│   │   ├── .env.example
│   │   ├── package.json
│   │   ├── src/{app,config,server}.ts
│   │   ├── test/foundation.test.mjs
│   │   └── tsconfig.json
│   └── mobile/
│       ├── android/
│       ├── ios/
│       ├── App.tsx
│       ├── app.json
│       ├── babel.config.js
│       ├── config.ts
│       ├── Gemfile
│       ├── index.js
│       ├── metro.config.js
│       ├── package.json
│       └── tsconfig.json
├── docs/phase-1.md
├── packages/shared/
│   ├── package.json
│   ├── src/index.ts
│   └── tsconfig.json
├── package-lock.json
├── package.json
└── tsconfig.base.json
```

## Environment

The apps can start with local defaults. To change them, copy each application's `.env.example` to `.env` in the same workspace and update the values there. `ADMIN_ORIGINS` is a comma-separated list of exact browser origins including ports. The default business time zone is `Asia/Kolkata`. `VITE_API_URL` is compiled into the admin bundle, so keep credentials out of it.

The mobile debug build uses `http://localhost:3000`. Set `releaseApiUrl` in `apps/mobile/config.ts` to the hosted HTTPS origin when configuring a release. Android permits cleartext traffic in debug builds for local development.

## API contract

`GET /api/health` returns HTTP 200 and the following JSON when Express is reachable.

```json
{"status":"ok","service":"renuka-api"}
```

The response disables caching and only advertises CORS permission for configured origins. Unknown routes return HTTP 404 with `{"error":"NOT_FOUND"}`. Both clients validate the payload and expose loading, connection failure, and retry states. The endpoint checks process liveness. The [Phase 2 backend guide](phase-2.md) covers database readiness and the Atlas configuration required to start the current API.

## Run and verify

1. From the root, run `npm ci`, `npm test`, and `npm run build`. The tests exercise the live Express endpoint on an ephemeral local port, CORS, security headers, invalid configuration, and coordinate bounds.
2. Start `npm run dev:api` and `npm run dev:admin` in separate terminals. Open http://localhost:5173. Stop the API and select **Check connection** to verify the visible error state. Restart the API and retry to verify recovery.
3. Run `npm run typecheck -w @renuka/mobile`. This uses the built shared workspace from step 1.
4. For Android, install Android Studio, the SDK and NDK versions in `apps/mobile/android/build.gradle`, and JDK 17. Start an emulator or attach a device. Run `adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:8081 tcp:8081`; add `adb -s DEVICE_SERIAL` when multiple devices are connected. In separate terminals, run `npm run start -w @renuka/mobile` and `npm run android -w @renuka/mobile -- --no-packager`.
5. For iOS, use macOS with Xcode and Ruby/Bundler. Run `bundle install` from `apps/mobile` and `bundle exec pod install` from `apps/mobile/ios`. Start Metro with `npm run start -w @renuka/mobile` from the root, then run `npm run ios -w @renuka/mobile -- --no-packager` in a second terminal. The simulator can reach the host API through localhost.
6. On each native client, confirm the connection is online. Stop the API, retry, then restart the API and retry again to exercise connection loss and recovery.

CI also builds an Android JavaScript bundle with Metro to verify the shared package resolves in the native client. Native signing and distribution are part of Phase 10.
