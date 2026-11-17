from pathlib import Path

from analyzers.route_security import analyze_route_security
from pipeline.reader import build_snapshot
from pipeline.timing import TimingLog


def snapshot_of(tmp_path: Path, files: dict[str, str]):
    for rel, text in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))
    return build_snapshot(tmp_path)


def test_flags_unprotected_admin_route_with_exact_shape(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "src/app.js": (
                "const express = require('express')\n"
                "const app = express()\n"
                "app.get('/admin/users', (req, res) => res.json([]))\n"
            )
        },
    )

    findings = analyze_route_security(snapshot)

    assert len(findings) == 1
    finding = findings[0]
    assert finding.to_dict() == {
        "analyzer": "route_security",
        "type": "unprotected_route",
        "severity": "high",
        "confidence": 0.8,
        "file": "src/app.js",
        "line": 3,
        "message": "Route GET /admin/users has no authentication middleware.",
        "fix_hint": (
            "Add an authentication middleware (for example requireAuth) to this route, "
            "or remove it from the public surface."
        ),
    }


def test_plain_get_route_is_medium_severity(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/items', handler)\n"})

    findings = analyze_route_security(snapshot)

    assert len(findings) == 1
    assert findings[0].severity == "medium"


def test_route_middleware_protects_the_route(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {"app.js": "app.get('/items', requireAuth, handler)\n"},
    )

    assert analyze_route_security(snapshot) == []


def test_auth_middleware_as_only_argument_protects_the_route(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/items', requireAuth)\n"})

    assert analyze_route_security(snapshot) == []


def test_global_auth_middleware_protects_all_routes(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "app.js": (
                "const { requireAuth } = require('./auth')\n"
                "app.use(requireAuth)\n"
                "app.get('/items', handler)\n"
            )
        },
    )

    assert analyze_route_security(snapshot) == []


def test_prefixed_global_guard_only_protects_its_prefix(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "app.js": (
                "app.use('/api', requireAuth)\n"
                "app.get('/api/items', handler)\n"
                "app.get('/other', handler)\n"
            )
        },
    )

    findings = analyze_route_security(snapshot)

    assert [finding.message for finding in findings] == [
        "Route GET /other has no authentication middleware."
    ]


def test_public_routes_are_not_flagged(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "app.js": (
                "app.get('/health', handler)\n"
                "app.post('/auth/login', handler)\n"
                "app.post('/register', handler)\n"
                "app.get('/metrics', handler)\n"
            )
        },
    )

    assert analyze_route_security(snapshot) == []


def test_probe_2xx_confirms_the_finding(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/items', handler)\n"})
    calls: list[tuple[str, str]] = []

    def probe(method: str, path: str) -> int:
        calls.append((method, path))
        return 200

    findings = analyze_route_security(snapshot, probe=probe)

    assert calls == [("GET", "/items")]
    assert len(findings) == 1
    assert findings[0].confidence == 0.95
    assert "answered 200 without a token" in findings[0].message


def test_probe_401_means_something_else_protects_the_route(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/items', handler)\n"})

    assert analyze_route_security(snapshot, probe=lambda method, path: 401) == []
    assert analyze_route_security(snapshot, probe=lambda method, path: 403) == []


def test_probe_500_keeps_the_ast_finding_at_base_confidence(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/items', handler)\n"})

    findings = analyze_route_security(snapshot, probe=lambda method, path: 500)

    assert len(findings) == 1
    assert findings[0].confidence == 0.8


def test_probe_error_never_breaks_the_analyzer(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/items', handler)\n"})

    def probe(method: str, path: str) -> int:
        raise RuntimeError("sandbox down")

    findings = analyze_route_security(snapshot, probe=probe)

    assert len(findings) == 1
    assert findings[0].confidence == 0.8


def test_non_get_routes_are_not_probed(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.post('/items', handler)\n"})
    calls: list[tuple[str, str]] = []

    def probe(method: str, path: str) -> int:
        calls.append((method, path))
        return 200

    findings = analyze_route_security(snapshot, probe=probe)

    assert calls == []
    assert findings[0].severity == "high"


def test_dynamic_paths_are_not_probed(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/items/:id', handler)\n"})
    calls: list[tuple[str, str]] = []

    def probe(method: str, path: str) -> int:
        calls.append((method, path))
        return 200

    findings = analyze_route_security(snapshot, probe=probe)

    assert calls == []
    assert len(findings) == 1


def test_typescript_router_post_is_detected(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "src/routes.ts": (
                "import express from 'express'\n"
                "const router = express.Router()\n"
                "router.post('/admin/reset', handler)\n"
            )
        },
    )

    findings = analyze_route_security(snapshot)

    assert len(findings) == 1
    assert findings[0].severity == "high"
    assert findings[0].line == 3


def test_chained_route_definition_is_detected(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {"app.js": "const app = express()\napp.route('/billing').get(handler)\n"},
    )

    findings = analyze_route_security(snapshot)

    assert len(findings) == 1
    assert findings[0].message == "Route GET /billing has no authentication middleware."
    assert findings[0].severity == "high"


def test_body_parser_middleware_is_not_mistaken_for_auth(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "app.js": (
                "const app = express()\n"
                "app.use(express.json())\n"
                "app.get('/items', handler)\n"
            )
        },
    )

    findings = analyze_route_security(snapshot)

    assert len(findings) == 1


def test_test_files_are_skipped(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "tests/app.test.js": "app.get('/admin/users', handler)\n",
            "src/latest.js": "app.get('/items', handler)\n",
        },
    )

    findings = analyze_route_security(snapshot)

    assert [finding.file for finding in findings] == ["src/latest.js"]


def test_non_web_javascript_has_no_findings(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {"src/math.js": "export const add = (a, b) => a + b\n"},
    )

    assert analyze_route_security(snapshot) == []


def test_header_get_is_not_a_route(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {"src/client.js": "const type = headers.get('content-type')\n"},
    )

    assert analyze_route_security(snapshot) == []


def test_map_get_is_not_a_route(tmp_path):
    snapshot = snapshot_of(tmp_path, {"src/cache.js": "cache.get('/admin')\n"})

    assert analyze_route_security(snapshot) == []


def test_app_get_setting_is_not_a_route(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "const mode = app.get('env')\n"})

    assert analyze_route_security(snapshot) == []


def test_router_created_by_factory_with_short_name_is_detected(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "app.js": (
                "const { Router } = require('express')\n"
                "const r = Router()\n"
                "r.get('/items', handler)\n"
            )
        },
    )

    findings = analyze_route_security(snapshot)

    assert len(findings) == 1
    assert findings[0].line == 3


def test_express_variable_with_short_name_is_detected(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "app.js": (
                "const express = require('express')\n"
                "const web = express()\n"
                "web.get('/admin/users', handler)\n"
            )
        },
    )

    findings = analyze_route_security(snapshot)

    assert len(findings) == 1
    assert findings[0].severity == "high"


def test_root_and_standard_public_auth_routes_are_not_flagged(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "app.js": (
                "app.get('/', handler)\n"
                "app.get('/google', handler)\n"
                "app.post('/refresh', handler)\n"
                "app.post('/logout', handler)\n"
            )
        },
    )

    assert analyze_route_security(snapshot) == []


def test_timing_records_analyzer_and_probe_stages(tmp_path):
    snapshot = snapshot_of(tmp_path, {"app.js": "app.get('/admin/users', handler)\n"})
    timing = TimingLog()

    analyze_route_security(snapshot, probe=lambda method, path: 200, timing=timing)

    assert "analyzer.route_security" in timing.entries
    assert "analyzer.route_security.probe" in timing.entries
