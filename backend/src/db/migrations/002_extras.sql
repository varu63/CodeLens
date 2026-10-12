-- =============================================================================
-- Additions on top of the agreed baseline schema (001_init.sql stays untouched).
-- These carry data the API serves but the baseline schema has no home for:
-- the structure map, per-stage run progress, finding fingerprints and the
-- presentation fields the web UI reads.
-- =============================================================================

-- Structure map captured by the scan stage (routes, components, tables, calls).
CREATE TABLE structures (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-stage progress for the live run view (8 stages per run).
CREATE TABLE run_stages (
  run_id      UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  status      check_status NOT NULL DEFAULT 'queued',
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  message     TEXT,
  PRIMARY KEY (run_id, stage)
);

-- Findings: stable identity across runs (fixed / still-failing / new) …
ALTER TABLE findings ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
CREATE INDEX findings_run_fingerprint_idx ON findings (run_id, fingerprint);

-- … plus the presentation fields the UI renders.
ALTER TABLE findings ADD COLUMN endpoint TEXT;
ALTER TABLE findings ADD COLUMN db_table TEXT;
-- Rendered evidence snapshot (small texts inlined, artifacts referenced by id).
ALTER TABLE findings ADD COLUMN evidence_cache JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE findings
  ALTER COLUMN not_tested TYPE JSONB
  USING COALESCE(to_jsonb(string_to_array(not_tested, E'\n')), '[]'::jsonb);
ALTER TABLE findings ALTER COLUMN not_tested SET DEFAULT '[]'::jsonb;

-- checks: short result message + stable ordering within a run.
ALTER TABLE checks ADD COLUMN message TEXT;
ALTER TABLE checks ADD COLUMN sort_order INT NOT NULL DEFAULT 0;
-- The baseline checks table has no created_at; the API orders by and returns it.
ALTER TABLE checks ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- load_results: the baseline stores avg/p95 only; the load charts render p50/p99.
ALTER TABLE load_results ADD COLUMN p50_ms NUMERIC(10,2);
ALTER TABLE load_results ADD COLUMN p99_ms NUMERIC(10,2);

-- runs: short human-readable summary.
ALTER TABLE runs ADD COLUMN summary TEXT;

-- artifacts: display name.
ALTER TABLE artifacts ADD COLUMN name TEXT NOT NULL DEFAULT '';
