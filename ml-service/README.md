# ProofLoop ml-service

Python service for the ML/LLM layer of ProofLoop. It reads a repository **once**,
runs fast analyzers over that snapshot, and — later steps — groups, scores, ranks
and explains findings. It never decides PASS/FAIL; deterministic checks do.

> **Golden rule:** normal tools (test runner, HTTP client, load tool) decide
> PASS/FAIL. ML and the LLM only group, score, rank and explain.

## Status (build order)

| Step | Work | Status |
| ---- | ---- | ------ |
| 1 | Snapshot reader + timing logs | **Done and tested** |
| 2 | Finding format, merge, route security | **Done and tested** |
| 3 | Fixtures + eval (BASELINE, rules only) | **Done and measured** |
| 4 | Complexity + data mapping | **Done and measured** |
| 5 | Model loading, MiniLM embeddings, Redis cache, HDBSCAN | Not started |
| 6 | Queue + worker + FastAPI + result cache | Not started |
| 7 | Ollama explainer with timeout + evidence checks | Not started |
| 8 | Offline mining + bug-risk model | Not started |
| 9 | Vulnerability classifier | Not started |
| 10 | Commit risk, flaky, bottleneck, severity (rules first) | Not started |

No model has been trained or downloaded yet. Nothing in this README claims a
model is "working" before its step is actually run and measured.

## Setup

```bash
cd ml-service
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # optional; every setting has a safe default
```

## Step 1: snapshot reader

`pipeline/reader.py` builds one read-only snapshot per run. All analyzers share
it, so the repository is walked and decoded once.

Rules enforced:

- Skip `node_modules`, `.git`, `dist`, `build`, `.next`
- Skip files over 1 MB (configurable), binaries (NUL byte), symlinks
- Caps: `SNAPSHOT_MAX_FILES` (default 5000), `SNAPSHOT_MAX_SECONDS` (default 60)
- Deterministic (sorted) file order; git commit SHA when the folder is a repo
- Text is decoded lazily and cached; paths outside the index are rejected
- Every stage records wall time in `TimingLog` (`snapshot.git_sha`,
  `snapshot.walk`, `snapshot.total`)

Try it on a real folder:

```bash
python -m pipeline.reader ../backend
```

Run the unit tests:

```bash
python -m pytest -v
```

Latest local run (Windows, Python 3.12.10):

```
103 passed, 1 skipped in 3.01s
```

Real snapshot of this repo's `backend/`: 388 files, 1.07 MB indexed,
10 ignored directories, 5 binary files, **137.5 ms total** (29.9 ms git SHA,
107.6 ms walk). `frontend/`: 79 files, 613 KB, **76.4 ms total**.

The one skipped test needs OS permission to create a symlink; it is skipped,
not failed, when Windows denies that.

## Step 2: findings, merge, route security

`pipeline/findings.py` defines the only finding shape analyzers may return:

```json
{ "analyzer": "...", "type": "...", "severity": "low|medium|high",
  "confidence": 0.0, "file": "...", "line": 1,
  "message": "...", "fix_hint": "..." }
```

Invalid severity, confidence outside 0–1, non-positive lines and empty
analyzer/type/file/message are rejected at construction.

`merge_findings()` applies, in order: confidence boost when two different
analyzers flag the same file (+0.1 per extra analyzer, capped at 1.0), duplicate
removal by `(file, line, type)` keeping the highest confidence, then sorting by
severity (high first), confidence (high first), and stable file/line keys.

`analyzers/route_security.py` parses JS/JSX/TS/TSX with tree-sitter and flags
Express routes that have no auth middleware. It recognises `app.use(auth)`
global guards, `/prefix` guards, per-route middleware, and chained
`app.route('/x').get(...)` definitions. It skips test files, public routes
(health, login/register, OAuth callback, refresh/logout, root), non-router
objects (`headers.get`, `cache.get`) and `app.get('env')` style settings calls.

Probing is optional: `analyze_route_security(snapshot, probe=http_probe(url))`
makes a real GET without a token. 2xx raises confidence to 0.95; 401/403 drops
the finding; timeouts/errors keep the AST finding at 0.8. Only GET routes with
concrete paths are probed, so nothing mutates and no `:id` route is guessed.
`http_probe` does not follow redirects and only calls the base URL it is given.

Measured on this repo's `backend/`: **214.5 ms** for 388 indexed files. Zero
findings in backend source; the 26 reported routes are real unprotected routes
inside `storage/projects/*` and `tmp/fixture-broken` copies of demo apps.

Known limits (until Step 6 wires the sandbox): router mount prefixes are not
resolved across files, so paths are reported as written; the optional probe is
what confirms the real reachable URL.

## Step 3: fixtures + baseline eval

Five tiny repos live in `fixtures/`, each with `expected.json`. Matching uses
`(file, line, type)`, the same key merge dedupes on. `repo_05_clean` must always
produce zero findings.

```bash
python -m eval.run_eval          # human-readable report
python -m eval.run_eval --json   # machine-readable report
```

Recorded baseline (rules only, only `route_security` implemented at this point):

```
repo_01_unprotected_route   correct=2  false_alarms=0  missed=0
repo_02_failing_test        correct=0  false_alarms=0  missed=1
repo_03_slow_endpoint       correct=0  false_alarms=0  missed=1
repo_04_complex_function    correct=0  false_alarms=0  missed=1
repo_05_clean               correct=0  false_alarms=0  missed=0

OVERALL: correct=2 false_alarms=0 missed=3
precision=1.00 recall=0.40
BASELINE (rules only, Step 3): route_security
```

The three misses were findings owned by analyzers not built yet: `test_runner`,
`load_test`, and `complexity`. They are tagged `[analyzer not implemented yet]`
and still count against recall. Tiny fixtures spend ~28 ms each in the git-SHA
lookup; the actual analyzers take ~1 ms.

## Step 4: complexity + data mapping

Two more tree-sitter rule analyzers. Both are pure: snapshot in, findings out.

`analyzers/complexity.py` measures every function (declaration, expression,
arrow, method, generator) on its own; nested callbacks are not charged to the
outer function.

- Cyclomatic complexity starts at 1 and adds 1 per `if`, loop, `catch`, ternary,
  `switch_case` (not `default`), and each `&&` / `||` / `??`.
- Nesting is the deepest control-flow block inside the function. An `else if`
  chain counts as one level, not many.
- Flagged at complexity ≥ 10 or nesting ≥ 4; severity is `high` at ≥ 15 or ≥ 5,
  otherwise `medium`. Confidence 0.9. Type `high_complexity`, line at the
  function start.

`analyzers/data_mapping.py` compares what the API returns with what the
frontend reads, at the top level of the response body.

- Backend: collects keys of object literals passed inline to `res.json({...})`
  or `res.status(...).json({...})` inside an Express route. Shapes are unioned
  across branches of the same method + path.
- Frontend: follows `const r = await fetch(url)` → `const data = await r.json()`,
  `const data = await fetch(url).then((r) => r.json())`, and direct
  `const { a, b } = await r.json()`. Reads are `data.field`, `data['field']`
  and destructuring from `data`.
- A field read on the frontend but absent from every response body of the same
  method + path is a finding: `data_mapping` / `missing_response_field`,
  severity `medium`, confidence 0.8, one finding per line (fields grouped).
- It stays quiet when it cannot prove both shapes: `res.json(variable)`,
  spreads, computed keys, handlers passed by name, dynamic fetch paths
  (template literals), unknown paths, and test files.

Fixture eval after Step 4 (same five fixtures, no new fixture added):

```
repo_01_unprotected_route   correct=2  false_alarms=0  missed=0
repo_02_failing_test        correct=0  false_alarms=0  missed=1
repo_03_slow_endpoint       correct=0  false_alarms=0  missed=1
repo_04_complex_function    correct=1  false_alarms=0  missed=0
repo_05_clean               correct=0  false_alarms=0  missed=0

OVERALL: correct=3 false_alarms=0 missed=2
precision=1.00 recall=0.60
BASELINE (rules only, Step 4): complexity, data_mapping, route_security
```

`repo_04`'s `priceOrder` is measured at complexity 13 / nesting 4 and flagged
`medium` at line 1, exactly as `expected.json` says. `repo_05_clean` still has
zero findings. The two remaining misses (`test_runner`, `load_test`) belong to
Steps 6+.

Measured on this repo (Windows, Python 3.12.10):

- `backend/` — 388 files: complexity **215.4 ms**, 55 findings (39 in `src/`,
  the rest in `storage/projects/*` and `tmp/` demo copies); data mapping
  **146.4 ms**, 0 findings.
- Whole repo — 2233 indexed files: data mapping **373.0 ms**, 0 findings. The
  real backend passes identifiers to `res.json(...)` and the frontend uses an
  API wrapper instead of raw `fetch`, so the analyzer correctly stays silent.

Known limits: the data mapping analyzer does not resolve router mount prefixes,
base-URL constants, or handlers imported from another file. It only matches
literal paths written identically on both sides; anything else is skipped
instead of guessed. Complexity thresholds are fixed rules, not a model.

## Layout

```
app/          FastAPI app (settings are here; routes arrive in Step 6)
pipeline/     reader.py, timing.py, findings.py
analyzers/    common.py, route_security.py, complexity.py, data_mapping.py
models/       offline-trained .joblib files (gitignored)
training/     offline mining/training scripts (Step 8+)
eval/         run_eval.py (baseline + later ML comparison)
fixtures/     five tiny repos, each with expected.json
tests/        pytest suites
```

## Fixed model choices (added in later steps, not swapped)

- Error/text embeddings: `sentence-transformers/all-MiniLM-L6-v2`
- Code embeddings: `microsoft/unixcoder-base` (vulnerability classifier only)
- Clustering: HDBSCAN on MiniLM vectors (fallback KMeans/signatures)
- Bug risk: scikit-learn `RandomForestClassifier`, trained offline
- Vulnerability: UniXcoder vector → `LogisticRegression`, trained offline
- LLM explainer: Ollama `qwen2.5-coder:1.5b` (optional `7b` via `.env`)

## Eval

```bash
python -m eval.run_eval
```

## Planned: pulling models, training (later steps)

These commands do not work yet; they are the targets for Steps 5–8 and will be
filled in with measured output when those steps are built.

- Models download automatically on first use in Step 5; optionally pre-pull:
  `huggingface-cli download sentence-transformers/all-MiniLM-L6-v2`
- Ollama: `ollama pull qwen2.5-coder:1.5b`
- Training: `python -m training.train_bug_risk` (Step 8)
