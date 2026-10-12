CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- TODO(ml): CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector, for embeddings

CREATE TYPE user_role       AS ENUM ('user', 'admin');
CREATE TYPE project_source  AS ENUM ('git', 'upload');
CREATE TYPE project_status  AS ENUM ('created', 'uploading', 'scanning', 'ready', 'error');
CREATE TYPE run_status      AS ENUM ('queued', 'running', 'passed', 'failed', 'cancelled', 'error');
CREATE TYPE check_type      AS ENUM ('structure', 'existing_tests', 'api', 'e2e', 'data_fetch',
                                     'data_mapping', 'db', 'load', 'security');
CREATE TYPE check_status    AS ENUM ('queued', 'running', 'passed', 'failed', 'skipped', 'error');
CREATE TYPE severity_level  AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE artifact_kind   AS ENUM ('log', 'screenshot', 'trace', 'report', 'zip', 'diff');

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  google_id     TEXT UNIQUE,
  avatar_url    TEXT,
  password_hash TEXT,                       -- optional, only for email/password login
  role          user_role NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,         -- store only the hash, never the token
  family_id   UUID NOT NULL,                -- for rotation and reuse detection
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE projects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  source         project_source NOT NULL,
  repo_url       TEXT,
  branch         TEXT NOT NULL DEFAULT 'main',
  storage_path   TEXT,                      -- where the uploaded zip / cloned copy lives
  status         project_status NOT NULL DEFAULT 'created',
  detected_stack JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings       JSONB NOT NULL DEFAULT '{"loadUsers":100,"thresholds":{"errorRatePct":1,"p95Ms":1000}}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_user_idx ON projects (user_id);

CREATE TABLE runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  triggered_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  parent_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,   -- set on rerun
  commit_sha    TEXT,
  status        run_status NOT NULL DEFAULT 'queued',
  load_users    INT NOT NULL DEFAULT 100 CHECK (load_users > 0),
  health_score  NUMERIC(5,2) CHECK (health_score BETWEEN 0 AND 100),
  environment   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE INDEX runs_project_idx ON runs (project_id, created_at DESC);

CREATE TABLE checks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type        check_type NOT NULL,
  name        TEXT NOT NULL,
  command     TEXT,
  exit_code   INT,
  duration_ms INT,
  status      check_status NOT NULL DEFAULT 'queued',
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE INDEX checks_run_idx ON checks (run_id, type);

CREATE TABLE test_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id          UUID NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  status            check_status NOT NULL,
  error_message     TEXT,
  stack_trace       TEXT,
  duration_ms       INT,
  failure_signature TEXT,                   -- hash of normalised error + top frame (used for grouping)
  flaky_probability NUMERIC(4,3)            -- TODO(ml): filled by the flaky-failure model
);
CREATE INDEX test_results_check_idx ON test_results (check_id);
CREATE INDEX test_results_signature_idx ON test_results (failure_signature);

CREATE TABLE load_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  route                TEXT NOT NULL,
  method               TEXT NOT NULL DEFAULT 'GET',
  users                INT NOT NULL,
  avg_ms               NUMERIC(10,2),
  p95_ms               NUMERIC(10,2),
  error_rate           NUMERIC(6,3),          -- percent
  requests_per_sec     NUMERIC(10,2),
  db_connection_errors INT NOT NULL DEFAULT 0,
  is_breaking_point    BOOLEAN NOT NULL DEFAULT false,
  bottleneck           TEXT                   -- TODO(ml): filled by the bottleneck/anomaly model (e.g. 'db_pool')
);
CREATE INDEX load_results_run_idx ON load_results (run_id, route, users);

CREATE TABLE findings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  cluster_id     UUID,                      -- findings sharing one root cause share a cluster_id
  severity       severity_level NOT NULL,
  category       TEXT NOT NULL,             -- e.g. 'auth', 'data_fetch', 'data_mapping', 'load', 'security'
  title          TEXT NOT NULL,
  description    TEXT,
  why_it_matters TEXT,
  file_path      TEXT,
  line_number    INT,
  evidence_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{type:'check'|'test_result'|'artifact'|'commit', id}]
  fix_steps      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ordered array of strings
  confidence     NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  not_tested     TEXT,                      -- what this check could not cover
  explained      BOOLEAN NOT NULL DEFAULT true,         -- false = LLM output failed evidence validation
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX findings_run_idx ON findings (run_id, severity);
CREATE INDEX findings_cluster_idx ON findings (cluster_id);

CREATE TABLE commits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha           TEXT NOT NULL,
  message       TEXT,
  author        TEXT,
  committed_at  TIMESTAMPTZ,
  files_changed INT NOT NULL DEFAULT 0,
  lines_added   INT NOT NULL DEFAULT 0,
  lines_deleted INT NOT NULL DEFAULT 0,
  diff_summary  JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_score    NUMERIC(3,2) CHECK (risk_score BETWEEN 0 AND 1),   -- TODO(ml): commit risk model
  risk_signals  JSONB NOT NULL DEFAULT '[]'::jsonb,
  description   TEXT,                                               -- TODO(ml): LLM-written description
  UNIQUE (project_id, sha)
);
CREATE INDEX commits_project_idx ON commits (project_id, committed_at DESC);

CREATE TABLE artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  check_id    UUID REFERENCES checks(id) ON DELETE SET NULL,
  kind        artifact_kind NOT NULL,
  storage_url TEXT NOT NULL,
  sha256      TEXT,
  size_bytes  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_run_idx ON artifacts (run_id);

CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id  UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  useful      BOOLEAN,
  fix_correct BOOLEAN,
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (finding_id, user_id)
);

CREATE TABLE agent_jobs (                   -- for POST /runs/:runId/send-to-agent
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent       TEXT NOT NULL,
  finding_ids UUID[] NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- TODO(ml): embeddings table (id, source_type, source_id, vector vector(1536)) with an ivfflat/hnsw index
