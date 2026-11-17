import pytest

from pipeline.findings import Finding, merge_findings


def make(**overrides: object) -> Finding:
    values: dict[str, object] = {
        "analyzer": "route_security",
        "type": "unprotected_route",
        "severity": "high",
        "confidence": 0.8,
        "file": "src/app.js",
        "line": 3,
        "message": "route has no auth",
        "fix_hint": "add auth",
    }
    values.update(overrides)
    return Finding(**values)  # type: ignore[arg-type]


def test_to_dict_has_the_exact_wire_shape():
    finding = make(confidence=0.834)

    assert list(finding.to_dict()) == [
        "analyzer",
        "type",
        "severity",
        "confidence",
        "file",
        "line",
        "message",
        "fix_hint",
    ]
    assert finding.to_dict()["confidence"] == 0.83


@pytest.mark.parametrize(
    "override",
    [
        {"severity": "critical"},
        {"confidence": -0.1},
        {"confidence": 1.1},
        {"confidence": float("nan")},
        {"line": 0},
        {"analyzer": "  "},
        {"type": ""},
        {"file": ""},
        {"message": ""},
        {"fix_hint": None},
    ],
)
def test_invalid_findings_are_rejected(override):
    with pytest.raises(ValueError):
        make(**override)


def test_merge_empty_input():
    assert merge_findings([]) == []


def test_merge_removes_duplicates_and_keeps_highest_confidence():
    low = make(line=10, confidence=0.6, message="low")
    high = make(line=10, confidence=0.9, message="high")

    merged = merge_findings([low, high])

    assert len(merged) == 1
    assert merged[0].confidence == 0.9
    assert merged[0].message == "high"


def test_merge_boosts_when_two_analyzers_flag_the_same_file():
    route = make(line=10, confidence=0.6)
    complexity = make(analyzer="complexity", type="high_complexity", line=20, confidence=0.5)

    merged = merge_findings([route, complexity])

    assert {item.analyzer: item.confidence for item in merged} == {
        "route_security": 0.7,
        "complexity": 0.6,
    }


def test_merge_boosts_duplicates_before_removing_them():
    first = make(analyzer="route_security", line=10, confidence=0.7)
    second = make(analyzer="complexity", line=10, confidence=0.8)

    merged = merge_findings([first, second])

    assert len(merged) == 1
    assert merged[0].analyzer == "complexity"
    assert merged[0].confidence == 0.9


def test_same_analyzer_does_not_boost_itself():
    one = make(line=10, confidence=0.6)
    two = make(line=20, confidence=0.5)

    merged = merge_findings([one, two])

    assert [item.confidence for item in merged] == [0.6, 0.5]


def test_three_analyzers_add_two_steps_of_confidence():
    findings = [
        make(analyzer="a", line=1, confidence=0.5),
        make(analyzer="b", line=2, confidence=0.5),
        make(analyzer="c", line=3, confidence=0.5),
    ]

    merged = merge_findings(findings)

    assert [item.confidence for item in merged] == [0.7, 0.7, 0.7]


def test_confidence_is_capped_at_one():
    findings = [
        make(analyzer="a", line=1, confidence=0.95),
        make(analyzer="b", line=2, confidence=0.9),
    ]

    merged = merge_findings(findings)

    assert [item.confidence for item in merged] == [1.0, 1.0]


def test_sort_is_severity_first_then_confidence():
    medium_high_conf = make(severity="medium", line=1, confidence=0.9)
    high_low_conf = make(severity="high", line=2, confidence=0.5)
    low_top_conf = make(severity="low", line=3, confidence=0.99)

    merged = merge_findings([medium_high_conf, high_low_conf, low_top_conf])

    assert [item.severity for item in merged] == ["high", "medium", "low"]


def test_sort_confidence_desc_inside_a_severity_band():
    low_conf = make(line=1, confidence=0.5)
    high_conf = make(line=2, confidence=0.9)

    merged = merge_findings([low_conf, high_conf])

    assert [item.confidence for item in merged] == [0.9, 0.5]


def test_merge_does_not_mutate_inputs():
    original = make(confidence=0.6)
    other = make(analyzer="complexity", type="other", line=9, confidence=0.5)

    merge_findings([original, other])

    assert original.confidence == 0.6
