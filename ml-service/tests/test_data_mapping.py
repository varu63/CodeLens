from pathlib import Path

from analyzers.data_mapping import analyze_data_mapping
from pipeline.reader import build_snapshot
from pipeline.timing import TimingLog


def snapshot_of(tmp_path: Path, files: dict[str, str]):
    for rel, text in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))
    return build_snapshot(tmp_path)


BACKEND_ITEMS = (
    "app.get('/api/items', (req, res) => {\n"
    "  res.json({ id: 1, title: 'x' })\n"
    "})\n"
)


def test_flags_field_the_response_never_returns(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  return data.title + data.price\n"
                "}\n"
            ),
        },
    )

    findings = analyze_data_mapping(snapshot)

    assert len(findings) == 1
    finding = findings[0]
    assert finding.analyzer == "data_mapping"
    assert finding.type == "missing_response_field"
    assert finding.severity == "medium"
    assert finding.confidence == 0.8
    assert finding.file == "frontend/api.js"
    assert finding.line == 4
    assert "price" in finding.message
    assert "GET /api/items" in finding.message


def test_matching_fields_are_not_flagged(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  return data.id + data.title\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_only_top_level_keys_are_compared(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": (
                "app.get('/api/user', (req, res) => {\n"
                "  res.json({ user: { id: 1 } })\n"
                "})\n"
            ),
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/user')\n"
                "  const data = await response.json()\n"
                "  return data.user.id\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_identifier_response_shape_is_unknown(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": (
                "app.get('/api/user', (req, res) => {\n"
                "  res.json(project)\n"
                "})\n"
            ),
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/user')\n"
                "  const data = await response.json()\n"
                "  return data.anything\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_spread_response_shape_is_unknown(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": (
                "app.get('/api/items', (req, res) => {\n"
                "  res.json({ ...item })\n"
                "})\n"
            ),
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  return data.anything\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_status_json_is_read_as_the_same_route(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": (
                "app.post('/api/items', (req, res) => {\n"
                "  res.status(201).json({ id: 2, title: 'y' })\n"
                "})\n"
            ),
            "frontend/api.js": (
                "async function create() {\n"
                "  const response = await fetch('/api/items', { method: 'POST' })\n"
                "  const data = await response.json()\n"
                "  return data.title + data.owner\n"
                "}\n"
            ),
        },
    )

    findings = analyze_data_mapping(snapshot)

    assert len(findings) == 1
    assert "owner" in findings[0].message
    assert "POST /api/items" in findings[0].message


def test_destructuring_the_data_variable_is_checked(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  const { title, price } = data\n"
                "  return title + price\n"
                "}\n"
            ),
        },
    )

    findings = analyze_data_mapping(snapshot)

    assert len(findings) == 1
    assert findings[0].line == 4
    assert "price" in findings[0].message


def test_destructuring_directly_from_json_is_checked(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const { id, total } = await response.json()\n"
                "  return id + total\n"
                "}\n"
            ),
        },
    )

    findings = analyze_data_mapping(snapshot)

    assert len(findings) == 1
    assert "total" in findings[0].message


def test_then_json_binding_is_followed(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const data = await fetch('/api/items').then((r) => r.json())\n"
                "  return data.title + data.total\n"
                "}\n"
            ),
        },
    )

    findings = analyze_data_mapping(snapshot)

    assert len(findings) == 1
    assert "total" in findings[0].message


def test_subscript_and_optional_reads_are_checked(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  return data['title'] + data?.total\n"
                "}\n"
            ),
        },
    )

    findings = analyze_data_mapping(snapshot)

    assert len(findings) == 1
    assert findings[0].line == 4
    assert "total" in findings[0].message


def test_one_finding_per_line_groups_missing_fields(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  return data.price + data.owner\n"
                "}\n"
            ),
        },
    )

    findings = analyze_data_mapping(snapshot)

    assert len(findings) == 1
    assert "owner, price" in findings[0].message


def test_other_path_is_not_matched(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/other')\n"
                "  const data = await response.json()\n"
                "  return data.price\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_other_method_is_not_matched(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function remove() {\n"
                "  const response = await fetch('/api/items', { method: 'DELETE' })\n"
                "  const data = await response.json()\n"
                "  return data.price\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_dynamic_fetch_path_is_skipped(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.js": (
                "async function load(id) {\n"
                "  const response = await fetch(`/api/items/${id}`)\n"
                "  const data = await response.json()\n"
                "  return data.price\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_named_handler_is_skipped(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": (
                "app.get('/api/items', itemsHandler)\n"
                "function itemsHandler(req, res) {\n"
                "  res.json({ id: 1 })\n"
                "}\n"
            ),
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  return data.price\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_test_files_are_skipped(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/routes.js": BACKEND_ITEMS,
            "frontend/api.test.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/items')\n"
                "  const data = await response.json()\n"
                "  return data.price\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_non_response_json_objects_are_ignored(tmp_path):
    snapshot = snapshot_of(
        tmp_path,
        {
            "backend/config.js": "const config = store.json({ price: 1 })\n",
            "frontend/api.js": (
                "async function load() {\n"
                "  const response = await fetch('/api/config')\n"
                "  const data = await response.json()\n"
                "  return data.price\n"
                "}\n"
            ),
        },
    )

    assert analyze_data_mapping(snapshot) == []


def test_timing_records_data_mapping_stage(tmp_path):
    snapshot = snapshot_of(tmp_path, {"frontend/api.js": "fetch('/x')\n"})
    timing = TimingLog()

    analyze_data_mapping(snapshot, timing=timing)

    assert "analyzer.data_mapping" in timing.as_dict()
