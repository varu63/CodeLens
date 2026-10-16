# ProofLoop — Backend

AI Codebase Verification & Engineering Intelligence platform. This service verifies a
repository with **deterministic checks**, then uses ML/LLM layers only to **group, score,
rank and explain** what those checks proved.

> **Golden rule:** deterministic tools decide PASS/FAIL. Models never do. Every finding
> must link to real evidence ids captured during the run, and every AI explanation is
> validated against that evidence before it is trusted.

## Stack

| Layer      | Choice                                                                 |
| ---------- | ---------------------------------------------------------------------- |
| Runtime    | Node 20+ · Express 4 · TypeScript (strict, no `any`) · ESM (NodeNext) |
| Storage    | PostgreSQL 16 via `pg` — raw SQL, no ORM; migrations are plain `.sql`  |
| Queue      | Redis + BullMQ (runs execute on a worker)                              |
| Sandbox    | Docker via `dockerode` — ephemeral containers, no network, capped CPU/RAM/time |
| Artifacts  | S3-compatible object storage via `@aws-sdk/client-s3` + signed URLs    |
| Auth       | JWT access tokens (~15 min) + rotating refresh tokens (~7 days), Google OAuth 2.0 |
| Validation | Zod · helmet · strict-origin CORS · express-rate-limit · multer        |
| Logging    | pino (+ pino-http)                                                     |
| Tests      | Vitest + supertest                                                     |

## Local setup

```bash
# 1. Infrastructure (Postgres + Redis + S3-compatible store)
docker compose up -d

# 2. Configuration
cp .env.example .env
#    set JWT_SECRET / JWT_REFRESH_SECRET (openssl rand -hex 32), adjust anything else

# 3. Install, migrate, seed the demo account, run
npm install
npm run migrate        # applies src/db/migrations/*.sql in order
npm run seed           # varun@acme.dev / password123 (admin) — for the frontend login
npm run dev            # API on http://localhost:5000 (tsx watch)
npm run worker         # in a second terminal: executes queued verification runs
```

The `DATABASE_URL` user/password/database **must match** `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` in `docker-compose.yml` (both default to
`proofloop`). A mismatch fails at startup with
`Database connection failed: check DATABASE_URL` — or, if the container was
recreated with new credentials over old volumes, `drop the pgdata volume and
docker compose up -d again`. Skipping `npm run migrate` fails at startup with
`Tables missing: run npm run migrate`.

The server checks the database before it starts accepting traffic; liveness and
DB status are exposed at `GET /api/v1/health`.

`npm run dev` alone serves the API; the run pipeline needs the worker connection to
BullMQ, so start both while testing runs.

### Manual error-path testing

- **Wrong password** — sign in with a bad password: the form shows "Invalid email or password" (401).
- **Duplicate email** — register an existing email: the form shows "An account with this email already exists" (409).
- **DB stopped** — `docker compose stop postgres`, then try to sign in: the form shows "Service temporarily unavailable" (503); `npm run dev` also exits at startup with `Database connection failed`.
- **Missing tables** — with Postgres running but a fresh volume, skip `npm run migrate` and start the API: startup exits with `Tables missing: run npm run migrate`.

The frontend talks to this API when `frontend/.env` has `VITE_USE_MOCKS=false`
(`VITE_API_URL=http://localhost:5000/api/v1`). With `VITE_USE_MOCKS=true` it runs fully
standalone against its in-memory mock backend.

## Project layout

```
src/
  routes/        # URL + middleware wiring only
  controllers/   # one per route; HTTP in/out, no DB code
  services/      # all business logic (commit, analysis, report, runs, projects, …)
    ml.client.ts # ← the ONLY place that talks to the ML/LLM service
  db/
    migrations/  # 001_init.sql, 002_extras.sql (plain SQL, applied in order)
    queries/     # raw SQL per table, camelCase aliased rows
  middleware/    # auth guard, error handler, validation, rate limits
  validators/    # Zod schemas per resource
  utils/         # mappers (DB row → wire shape), errors, logger, asyncHandler
scripts/
  seed.ts        # demo user upsert
tests/           # Vitest unit + supertest suites
sandbox/         # Dockerfile + entrypoint used for ephemeral run containers
```

Layering is strict: **routes** declare URLs and middleware, **controllers** translate
HTTP ↔ service calls, **services** own the logic and are the only layer that touches
`db/queries`. All reads are scoped by the caller's `token.sub`, and every
project/run/finding/commit/artifact route returns **404 (not 403)** for foreign
resources so resource ids cannot be probed.

## API (base `/api/v1`)

Error shape everywhere: `{ "error": { "code": "...", "message": "..." } }` (validation
failures add `details[]`). Paginated lists return `{ items, page, limit, total, totalPages }`.

**Health**

| Method | Path      | Purpose                          |
| ------ | --------- | -------------------------------- |
| GET    | `/health` | Liveness + Postgres connectivity |

**Auth** (rate-limited; tokens never appear in URLs)

| Method | Path                    | Purpose                                            |
| ------ | ----------------------- | -------------------------------------------------- |
| GET    | `/auth/google`          | Start Google OAuth (state cookie, PKCE-ready)      |
| GET    | `/auth/google/callback` | OAuth callback → sets refresh cookie, redirects    |
| POST   | `/auth/register`        | Email + password signup                            |
| POST   | `/auth/login`           | Email + password login                             |
| POST   | `/auth/refresh`         | Rotate refresh token (reuse revokes the family)    |
| POST   | `/auth/logout`          | Revoke the refresh family, clear the cookie        |
| GET    | `/auth/me`              | Current user                                       |

**Projects**

| Method | Path                       | Purpose                                    |
| ------ | -------------------------- | ------------------------------------------ |
| GET    | `/projects`                | List owned projects (filters + pagination) |
| POST   | `/projects`                | Create project (empty shell or from git)   |
| GET    | `/projects/:id`            | Project detail incl. detected stack        |
| PATCH  | `/projects/:id`            | Rename / update settings                   |
| DELETE | `/projects/:id`            | Delete project + artifacts                 |
| POST   | `/projects/:id/upload`     | Zip upload → extracted with zip-slip guard |
| GET    | `/projects/:id/structure`  | Structure map (routes, tables, components) |
| POST   | `/projects/:id/runs`       | Start a verification run → `202 { runId }` |
| GET    | `/projects/:id/runs`       | List runs                                  |

**Runs**

| Method | Path                              | Purpose                                        |
| ------ | --------------------------------- | ---------------------------------------------- |
| GET    | `/runs/:runId`                    | Run detail (status, health, stage progress)    |
| GET    | `/runs/:runId/stream`             | Server-sent events: status/stage/check/finding |
| GET    | `/runs/:runId/checks`             | Checks with messages + artifact ids            |
| GET    | `/runs/:runId/load-test`          | Load-test results per route/level              |
| GET    | `/runs/:runId/findings`           | Finding list (severity/category/cluster/search)|
| GET    | `/runs/:runId/report?format=json\|pdf` | Full report (JSON contract or PDF download) |
| POST   | `/runs/:runId/cancel`             | Cancel a queued/running run                    |
| POST   | `/runs/:runId/rerun`              | Re-run with the same configuration             |
| POST   | `/runs/:runId/send-to-agent`      | Queue selected findings for a coding agent (`202`) |
| GET    | `/runs/:runId/artifacts/:artifactId` | Inline artifact content + signed URL        |

**Findings**

| Method | Path                          | Purpose                                          |
| ------ | ----------------------------- | ------------------------------------------------ |
| GET    | `/findings`                   | All findings across the caller's projects        |
| GET    | `/findings/:findingId`        | Finding detail with rendered evidence            |
| POST   | `/findings/:findingId/feedback` | `{ useful, fixCorrect, comment? }` — one per user |

**Commits**

| Method | Path                              | Purpose                                   |
| ------ | --------------------------------- | ----------------------------------------- |
| GET    | `/projects/:projectId/commits`    | Analyzed history (risk score, signals)    |
| GET    | `/projects/:projectId/commits/:sha` | One commit (full or 7+ char short sha)  |

## The ML/LLM boundary

**All** ML/LLM traffic goes through `src/services/ml.client.ts`. With `ML_ENABLED=false`
(default) every function falls back to a deterministic rule-based stub, so the product
works end to end with zero ML dependencies:

- `commitRisk` — weighted rule score (file count, churn, hotspots, sensitive paths,
  tests moved, message type) scaled 0–100 on the wire.
- `embedTexts` / `clusterFindings` — findings sharing a category + concrete location
  (file, endpoint, table or title) get one stable cluster id per project, so
  `clusterSize` reads as "N failures, 1 root cause" and stays identical across reruns.
- `explainFinding` — why-it-matters + fix steps, citing evidence ids and file paths.

Every stub carries a `// TODO(ml): …` marker naming the model and the ML endpoint to
replace it with. When `ML_ENABLED=true` the service calls `ML_SERVICE_URL` (key in
`ML_SERVICE_KEY`); any ML failure falls back to the rule path so a run never loses data.

**Explanation validation:** an explanation is only trusted when every cited evidence id
belongs to the finding and every cited file path was seen by the scan (the finding's own
path is authoritative). Otherwise `findings.explained=false` → the wire
`evidenceValidated=false` and the UI shows it as unverified.

## Security notes

- Access JWTs expire in ~15 min (claims `sub`, `role`); refresh tokens rotate on every
  use, are stored **only as hashes**, and reusing a rotated token revokes the entire
  token family.
- Refresh token travels in an httpOnly + Secure + SameSite cookie (Secure enforced in
  production); access tokens only in the `Authorization` header. OAuth uses a state
  cookie — tokens never appear in URLs.
- Zip uploads are size-limited and guarded against zip-slip (`..`, absolute paths,
  symlinks) before extraction; the sandbox never touches the original uploaded files.
- Verification runs execute in ephemeral Docker containers with no network access and
  capped CPU/memory/time.
- Ownership checks on every resource route (foreign ids → 404); auth routes are
  rate-limited; tokens and secrets are never logged.

## Tests

```bash
npm test           # Vitest: unit suites (ml.client, analysis, mappers, validators
                   # + supertest app wiring). No Postgres/Redis needed.
npm run typecheck  # tsc for src + tests projects
```

The end-to-end pipeline (zip → run → SSE → findings → commits → report → feedback →
send-to-agent) is additionally exercised by the scripts in `tmp/` against a live stack.
