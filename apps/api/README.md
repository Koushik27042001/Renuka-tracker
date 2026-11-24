# Renuka Tracker API

See the [Phase 2 guide](../../docs/phase-2.md) for Atlas, configuration, bootstrap, authentication examples and deployment. The OpenAPI source is [openapi.json](openapi.json).

## Backend inventory

```text
apps/api/
  .env.example
  .prettierrc.json
  README.md
  eslint.config.mjs
  openapi.json
  package.json
  tsconfig.json
  tsconfig.test.json
  src/
    app.ts
    config.ts
    server.ts
    config/
      database.ts
      logger.ts
    middleware/
      authenticate.ts
      authorize.ts
      errors.ts
      rateLimiter.ts
      validateRequest.ts
    models/
      AuditLog.model.ts
      RefreshSession.model.ts
      User.model.ts
      index.ts
    modules/
      auth/
        audit.ts
        auth.controller.ts
        auth.routes.ts
        auth.service.ts
        auth.validation.ts
        password.ts
        tokens.ts
      users/
        user.service.ts
        user.validation.ts
    scripts/
      createAdmin.ts
      createIndexes.ts
    types/
      express.d.ts
  test/
    foundation.test.ts
```

Phase 2 updates the existing API entry points, environment example and workspace package manifest. The Vitest integration suite replaces `test/foundation.test.mjs`. At the workspace level, Phase 2 updates `package.json`, `package-lock.json`, `.github/workflows/checks.yml`, `README.md` and `docs/phase-1.md`, and adds `docs/phase-2.md`.
