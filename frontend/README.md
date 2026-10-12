# ProofLoop — Frontend

ProofLoop is an AI codebase verification and engineering intelligence platform.
This repository contains the React frontend: connect a codebase, run the check
suite, and inspect evidence-backed findings, commits and load results.

**Tests decide PASS / FAIL. AI only explains — every finding carries its evidence.**

## Stack

React 18 · TypeScript (strict) · Vite · React Router v6 · TanStack Query ·
Zustand · Axios · Tailwind CSS · Recharts · lucide-react · Zod + react-hook-form

## Getting started

```bash
npm install
cp .env.example .env   # then adjust if needed
npm run dev            # http://localhost:5173
```

### Scripts

| Script              | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the dev server (Vite)         |
| `npm run build`     | Typecheck + production build        |
| `npm run preview`   | Serve the production build locally  |
| `npm run lint`      | ESLint (flat config)                |
| `npm run typecheck` | TypeScript, no emit                 |

## Environment variables

All variables are consumed through `import.meta.env` — never put secrets or
tokens in URLs or source files.

| Variable          | Default                      | Purpose                                                   |
| ----------------- | ---------------------------- | --------------------------------------------------------- |
| `VITE_API_URL`    | `http://localhost:5000/api/v1` | Base URL of the ProofLoop API. All API calls are relative to it. |
| `VITE_USE_MOCKS`  | `false`                      | `true` runs the entire UI against a built-in mock API adapter with a realistic sample dataset — no backend needed. |

### Mock mode

With `VITE_USE_MOCKS=true` you get a scripted booking-app story:

- an unprotected admin route (**Critical**), a 404ing `/api/service-list` (**High**),
  a `serviceId` vs `service_id` mapping cluster (5 failures, 1 root cause),
  and a DB pool failure at 100 concurrent users (18% error rate);
- a live-streaming "Verify" run with per-stage progress, checks, findings and load results;
- a **Rerun** that proves fixes: 5 findings fixed, 2 still failing, 1 new.

## Project structure

```
src/
  api/          # typed API layer — the only place that talks HTTP
  components/   # ui/ · layout/ · runs/ · findings/ · commits/ · projects/
  hooks/        # TanStack Query hooks, SSE stream, theme, auth
  pages/        # one component per route
  store/        # Zustand stores (auth token kept IN MEMORY only)
  mocks/        # mock adapter + scripted sample data
  types/        # api.types.ts (wire) · domain.types.ts (models)
  utils/        # formatting, comparison, formatters
  styles/       # Tailwind layers + semantic color tokens
```

## Auth model

- Google OAuth redirects through the backend (`${VITE_API_URL}/auth/google`) — no
  client secret ever touches the frontend.
- The access token lives in a Zustand store **in memory only**; persistence is a
  httpOnly refresh cookie. On 401 the axios client refreshes once, replays queued
  requests, and signs out only if refresh fails.
- Admin-only areas are guarded by `user.role`.
