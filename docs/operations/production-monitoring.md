# Production monitoring

Monitor liveness and readiness separately. Probe readiness from the deployment environment. Configure a private Prometheus collector with a bearer token when metrics collection is enabled. Alert on sustained readiness failures, HTTP 5xx rates, upload failures and offline sync failures. Use request IDs to correlate sanitized logs. Capture exit status and sanitized summary logs for manual or approved scheduled cleanup executions.

Run `npm run evidence:cleanup -w @renuka/api` from the built deployment to assess cleanup candidates before an approved apply. Review provider errors and rerun after resolving them.
