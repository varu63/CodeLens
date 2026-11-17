from pathlib import Path

from analyzers.complexity import analyze_complexity
from pipeline.reader import build_snapshot
from pipeline.timing import TimingLog


def snapshot_of(tmp_path: Path, files: dict[str, str]):
    for rel, text in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))
    return build_snapshot(tmp_path)


def test_flags_nested_and_branchy_function(tmp_path):
    source = (
        "function priceOrder(order) {\n"
        "  let total = 0\n"
        "  if (!order) return 0\n"
        "  for (const item of order.items) {\n"
        "    if (item.quantity > 0) {\n"
        "      if (item.discount) {\n"
        "        if (order && order.vip) {\n"
        "          total += 1\n"
        "        } else {\n"
        "          total += 2\n"
        "        }\n"
        "      }\n"
        "    }\n"
        "  }\n"
        "  return total\n"
        "}\n"
    )
    snapshot = snapshot_of(tmp_path, {"src/orders.js": source})

    findings = analyze_complexity(snapshot)

    assert len(findings) == 1
    finding = findings[0]
    assert finding.analyzer == "complexity"
    assert finding.type == "high_complexity"
    assert finding.severity == "medium"
    assert finding.confidence == 0.9
    assert finding.file == "src/orders.js"
    assert finding.line == 1
    assert "priceOrder" in finding.message
    assert "complexity 7" in finding.message
    assert "nesting depth 4" in finding.message


def test_simple_function_is_not_flagged(tmp_path):
    source = (
        "export function add(a, b) {\n"
        "  if (a < 0) return b\n"
        "  return a + b\n"
        "}\n"
    )
    snapshot = snapshot_of(tmp_path, {"src/math.js": source})

    assert analyze_complexity(snapshot) == []


def test_nested_callback_is_measured_separately(tmp_path):
    source = (
        "function handler(items) {\n"
        "  if (!items) return []\n"
        "  return items.map((item) => {\n"
        "    if (item.a && item.b) return 1\n"
        "    if (item.c || item.d) return 2\n"
        "    return 0\n"
        "  })\n"
        "}\n"
    )
    snapshot = snapshot_of(tmp_path, {"src/handler.js": source})

    assert analyze_complexity(snapshot) == []


def test_arrow_function_name_comes_from_variable(tmp_path):
    branches = "".join(f"    if (x === {i}) return {i}\n" for i in range(11))
    source = "const classify = (x) => {\n" + branches + "    return -1\n  }\n"
    snapshot = snapshot_of(tmp_path, {"src/classify.ts": source})

    findings = analyze_complexity(snapshot)

    assert len(findings) == 1
    assert "classify" in findings[0].message
    assert findings[0].line == 1


def test_very_deep_function_is_high_severity(tmp_path):
    source = (
        "function deep(a) {\n"
        "  if (a) {\n"
        "    if (a.b) {\n"
        "      if (a.c) {\n"
        "        if (a.d) {\n"
        "          if (a.e) {\n"
        "            return 1\n"
        "          }\n"
        "        }\n"
        "      }\n"
        "    }\n"
        "  }\n"
        "  return 0\n"
        "}\n"
    )
    snapshot = snapshot_of(tmp_path, {"src/deep.js": source})

    findings = analyze_complexity(snapshot)

    assert len(findings) == 1
    assert findings[0].severity == "high"


def test_else_if_chain_does_not_add_nesting(tmp_path):
    source = (
        "function pick(kind) {\n"
        "  if (kind === 1) return 'one'\n"
        "  else if (kind === 2) return 'two'\n"
        "  else if (kind === 3) return 'three'\n"
        "  return 'other'\n"
        "}\n"
    )
    snapshot = snapshot_of(tmp_path, {"src/pick.js": source})

    assert analyze_complexity(snapshot) == []


def test_method_definition_uses_method_name(tmp_path):
    branches = "".join(f"    if (this.x === {i}) return {i}\n" for i in range(10))
    source = "class Service {\n  decide() {\n" + branches + "    return -1\n  }\n}\n"
    snapshot = snapshot_of(tmp_path, {"src/service.js": source})

    findings = analyze_complexity(snapshot)

    assert len(findings) == 1
    assert "decide" in findings[0].message


def test_test_files_are_skipped(tmp_path):
    branches = "".join(f"  if (x === {i}) return {i}\n" for i in range(11))
    source = "function big(x) {\n" + branches + "  return -1\n}\n"
    snapshot = snapshot_of(tmp_path, {"tests/big.test.js": source})

    assert analyze_complexity(snapshot) == []


def test_timing_records_complexity_stage(tmp_path):
    source = "function add(a, b) { return a + b }\n"
    snapshot = snapshot_of(tmp_path, {"src/add.js": source})
    timing = TimingLog()

    analyze_complexity(snapshot, timing=timing)

    assert "analyzer.complexity" in timing.as_dict()
