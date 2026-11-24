# Renuka Tracker

The [Phase 2 backend guide](docs/phase-2.md) covers MongoDB Atlas, authentication, and initial administrator setup. Configure the database and apply indexes before starting the API.

Phase 1 provides the npm workspace, the Express API health endpoint, and real API connection screens in the React admin and React Native employee apps. See [Phase 1 setup](docs/phase-1.md) for the workspace layout, API contract, and native run instructions.

```sh
npm ci
npm test
npm run build
npm run typecheck -w @renuka/mobile
```

Run `npm run dev:api` and `npm run dev:admin` in separate terminals, then open http://localhost:5173. The admin shows the live API connection status.

The [Phase 3 employee management guide](docs/phase-3.md) covers onboarding, department permissions, and the admin dashboard.

The [Phase 4 attendance guide](docs/phase-4.md) covers mobile GPS check-in and checkout, reports, and setup.

The [Phases 5–7 guide](docs/phases-5-7.md) covers GPS selfie evidence, visit reviews, maps, and analytics.

## Production release

See the [Phases 8â€“12 delivery inventory](docs/phases-8-12-delivery.md), [deployment guide](docs/deployment/overview.md), [launch checklist](docs/production-launch-checklist.md), and [physical device test matrix](docs/mobile-device-test-checklist.md).
