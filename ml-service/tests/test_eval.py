from pathlib import Path

import pytest

from eval.run_eval import ExpectedFinding, FIXTURES_DIR, evaluate_fixture, score
from pipeline.findings import Finding


def expected(file: str = "a.js", line: int = 1, type_name: str = "unprotected_route") -> ExpectedFinding:
    return ExpectedFinding(
        analyzer="route_security",
        type=type_name,
        file=file,
        line=line,
        severity="high",
    )


def actual(file: str = "a.js", line: int = 1, type_name: str = "unprotected_route") -> Finding:
    return Finding(
        analyzer="route_security",
        type=type_name,
        severity="high",
        confidence=0.8,
        file=file,
        line=line,
        message="message",
        fix_hint="fix",
    )


def test_score_perfect_match():
    result = score([expected()], [actual()])

    assert result.true_positives == 1
    assert result.false_positives == 0
    assert result.false_negatives == 0
    assert result.precision == 1.0
    assert result.recall == 1.0


def test_score_counts_false_alarms():
    result = score([], [actual()])

    assert result.true_positives == 0
    assert result.false_positives == 1
    assert result.false_negatives == 0
    assert result.precision == 0.0
    assert result.recall == 1.0


def test_score_counts_missed_findings():
    result = score([expected()], [])

    assert result.true_positives == 0
    assert result.false_positives == 0
    assert result.false_negatives == 1
    assert result.precision == 1.0
    assert result.recall == 0.0


def test_score_matches_by_file_line_and_type():
    result = score([expected(file="a.js", line=3)], [actual(file="a.js", line=4)])

    assert result.true_positives == 0
    assert result.false_positives == 1
    assert result.false_negatives == 1


def test_duplicate_expected_keys_are_rejected():
    with pytest.raises(ValueError, match="duplicate"):
        score([expected(), expected()], [])


def test_repo_01_catches_all_expected_routes_without_false_alarms():
    result = evaluate_fixture(FIXTURES_DIR / "repo_01_unprotected_route")

    assert result.match.true_positives == 2
    assert result.match.false_alarms == ()
    assert result.match.missed == ()
    assert len(result.findings) == 2


def test_repo_04_catches_complex_function():
    result = evaluate_fixture(FIXTURES_DIR / "repo_04_complex_function")

    assert result.match.true_positives == 1
    assert result.match.false_alarms == ()
    assert result.match.missed == ()
    finding = result.findings[0]
    assert finding.analyzer == "complexity"
    assert finding.type == "high_complexity"
    assert finding.file == "src/orders.js"
    assert finding.line == 1
    assert finding.severity == "medium"


def test_baseline_is_three_correct_zero_false_alarms():
    results = [evaluate_fixture(path) for path in sorted(FIXTURES_DIR.glob("repo_*"))]

    correct = sum(result.match.true_positives for result in results)
    false_alarms = sum(result.match.false_positives for result in results)
    missed = sum(result.match.false_negatives for result in results)

    assert (correct, false_alarms, missed) == (3, 0, 2)


def test_repo_05_clean_produces_zero_findings():
    result = evaluate_fixture(FIXTURES_DIR / "repo_05_clean")

    assert result.findings == ()
    assert result.match.true_positives == 0
    assert result.match.false_alarms == ()
    assert result.match.missed == ()


def test_every_fixture_has_expected_json():
    fixture_paths = sorted(path for path in Path(FIXTURES_DIR).glob("repo_*") if path.is_dir())

    assert len(fixture_paths) == 5
    for path in fixture_paths:
        assert (path / "expected.json").is_file(), f"missing expected.json for {path.name}"
