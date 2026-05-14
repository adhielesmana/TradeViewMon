# Trady — AGENTS.md

Commands are listed at `package.json` scripts. Key ones:

- `npm run dev` — starts both Vite dev server + Express API on port 5000 via `tsx server/index.ts`
- `npm run build` — runs `script/build.ts`: esbuild-bundles server to `dist/index.cjs` + Vite-builds client to `dist/public/`
- `npm run start` — production: `node dist/index.cjs` (requires build first)
- `npm run check` — `tsc` typechecks all `client/src/`, `shared/`, `server/` (noEmit)
- `npm run db:push` — `drizzle-kit push` for schema sync
- `npm run ml:sidecar` — runs `python3 ml/sidecar.py` (local ML ensemble server on port 8001)

No test runner, linter, or formatter is configured.

## Project structure

| Path | Role |
|---|---|
| `shared/schema.ts` | Drizzle schema, zod validation, shared TypeScript types. Single source of truth for all DB tables. |
| `server/index.ts` | Express entrypoint: sessions (PG store), compression, cache headers, route registration, Vite dev/prod setup |
| `server/routes.ts` | All REST API routes (2856+ lines). Prefix: `/api/*`. |
| `server/scheduler.ts` | `node-cron` tasks (60s market fetch, hourly AI analysis, etc.) |
| `server/db.ts` | Drizzle client — auto-detects Neon (WebSocket) vs standard pg pool |
| `client/src/App.tsx` | React root: lazy-loaded pages, wouter routing, auth guard, sidebar layout |
| `ml/sidecar.py` | Pure-Python ensemble sidecar server — dependency-light, uses only stdlib |
| `deploy/` | Dockerfile, docker-compose (app + ml-sidecar + db), nginx template, `deploy.sh`, `entrypoint.sh`, migrations |

Path aliases (vite + tsconfig): `@/` → `client/src/`, `@shared/` → `shared/`, `@assets/` → `attached_assets/`

## Key architecture notes

- **Monorepo, single package**: all deps in one `package.json`. Server and client share `shared/schema.ts`.
- **No migrations migration**: Drizzle schema is the authority. `deploy/migrations/init_database.sql` is the production migration script (idempotent, run on every deploy via `entrypoint.sh`). `drizzle-kit push` is for dev only.
- **Database auto-detection**: `server/db.ts` uses Neon WebSocket driver when `DATABASE_URL` contains `neon.tech` and `NODE_ENV` is not production; otherwise standard pg pool. Both modes support the same schema.
- **Session store**: PostgreSQL via `connect-pg-simple`. Cookie name is `trady.sid`. Session table auto-created on startup.
- **Build split**: `script/build.ts` bundles the server with esbuild (allowlist of ~30 deps bundled, rest external) and uses Vite for client. Cold start optimization via bundled deps.
- **ML sidecar**: Python HTTP server (stdlib only) serving ensemble predictions. Configured via `ML_SIDECAR_URL`, defaults to `http://ml-sidecar:8001` in Docker.
- **Market hours**: `server/scheduler.ts` detects Forex/Metals (Sun 5PM—Fri 5PM EST) vs Crypto (24/7) per symbol to gate API calls.
- **API cache headers**: Applied in `server/index.ts` — market data 30s, news 5min, predictions 1min, other GET 10s.
- **Docker timezone**: All containers mount host `/etc/localtime` + `TZ` env. Default `Asia/Jakarta`.

## Deployment

- Self-hosted Docker. Run `./deploy/deploy.sh` (with `--domain` + email for first-time SSL setup).
- Uses docker-compose: `ml-sidecar` → `app` → `db` dependency chain with healthchecks.
- Production port mapping: `127.0.0.1:8111:5000` (nginx reverse proxy expected in front).
- `init_database.sql` runs on every container start via `entrypoint.sh` — must stay idempotent.
- Test/demo users are only seeded in dev, NOT in production.

## Testing and expectations

- No test files exist in the repo. There is no test command.
- No lint/format config. `tsc` (`npm run check`) is the only verification.
