"""Rules-only baseline eval over the fixture repos.

Matching key is (file, line, type) — the same key used by merge_findings.
The runner prints per-repo correct / false alarms / missed, every stage time,
then overall precision and recall. It is a measurement tool, not a pass/fail
gate: expected findings for analyzers not built yet show up as missed.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

from analyzers.complexity import analyze_complexity
from analyzers.data_mapping import analyze_data_mapping
from analyzers.route_security import analyze_route_security
from pipeline.findings import Finding, merge_findings
from pipeline.reader import build_snapshot
from pipeline.timing import TimingLog

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
IMPLEMENTED_ANALYZERS = frozenset({"route_security", "complexity", "data_mapping"})


@dataclass(frozen=True)
class ExpectedFinding:
    analyzer: str
    type: str
    file: str
    line: int
    severity: str | None = None
    note: str | None = None

    @property
    def key(self) -> tuple[str, int, str]:
        return (self.file, self.line, self.type)


@dataclass(frozen=True)
class MatchResult:
    correct: tuple[ExpectedFinding, ...]
    false_alarms: tuple[Finding, ...]
    missed: tuple[ExpectedFinding, ...]

    @property
    def true_positives(self) -> int:
        return len(self.correct)

    @property
    def false_positives(self) -> int:
        return len(self.false_alarms)

    @property
    def false_negatives(self) -> int:
        return len(self.missed)

    @property
    def precision(self) -> float:
        denominator = self.true_positives + self.false_positives
        return self.true_positives / denominator if denominator else 1.0

    @property
    def recall(self) -> float:
        denominator = self.true_positives + self.false_negatives
        return self.true_positives / denominator if denominator else 1.0


@dataclass(frozen=True)
class RepoResult:
    name: str
    directory: Path
    match: MatchResult
    findings: tuple[Finding, ...]
    timings_ms: dict[str, float]


def score(expected: Iterable[ExpectedFinding], actual: Iterable[Finding]) -> MatchResult:
    expected_list = list(expected)
    actual_list = list(actual)

    expected_keys = [item.key for item in expected_list]
    if len(set(expected_keys)) != len(expected_keys):
        raise ValueError("expected.json contains duplicate (file, line, type) keys")

    expected_key_set = set(expected_keys)
    actual_keys = {(item.file, item.line, item.type) for item in actual_list}

    return MatchResult(
        correct=tuple(item for item in expected_list if item.key in actual_keys),
        false_alarms=tuple(
            item for item in actual_list if (item.file, item.line, item.type) not in expected_key_set
        ),
        missed=tuple(item for item in expected_list if item.key not in actual_keys),
    )


def load_expected(fixture_dir: Path) -> list[ExpectedFinding]:
    path = fixture_dir / "expected.json"
    if not path.is_file():
        raise FileNotFoundError(f"missing expected.json in {fixture_dir}")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"{path}: invalid JSON: {error}") from error

    if not isinstance(data, dict) or data.get("repo") != fixture_dir.name:
        raise ValueError(f"{path}: repo must match folder name {fixture_dir.name!r}")
    raw_findings = data.get("findings")
    if not isinstance(raw_findings, list):
        raise ValueError(f"{path}: findings must be a list")

    findings: list[ExpectedFinding] = []
    for raw in raw_findings:
        if not isinstance(raw, dict):
            raise ValueError(f"{path}: finding entries must be objects")
        try:
            analyzer = str(raw["analyzer"]).strip()
            type_name = str(raw["type"]).strip()
            file_name = str(raw["file"]).strip()
            line = int(raw["line"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"{path}: bad finding entry {raw!r}") from error
        if not analyzer or not type_name or not file_name or line < 1:
            raise ValueError(f"{path}: finding needs analyzer, type, file and line >= 1: {raw!r}")
        severity = raw.get("severity")
        note = raw.get("note")
        findings.append(
            ExpectedFinding(
                analyzer=analyzer,
                type=type_name,
                file=file_name,
                line=line,
                severity=str(severity) if severity is not None else None,
                note=str(note) if note is not None else None,
            )
        )
    return findings


def analyze_fixture(fixture_dir: Path) -> tuple[tuple[Finding, ...], dict[str, float]]:
    timing = TimingLog()
    started = time.perf_counter()
    snapshot = build_snapshot(fixture_dir, timing=timing)
    raw_findings = (
        analyze_route_security(snapshot, timing=timing)
        + analyze_complexity(snapshot, timing=timing)
        + analyze_data_mapping(snapshot, timing=timing)
    )
    with timing.stage("eval.merge"):
        merged = merge_findings(raw_findings)
    timing.record("eval.total", (time.perf_counter() - started) * 1000)
    return tuple(merged), timing.as_dict()


def evaluate_fixture(fixture_dir: str | Path) -> RepoResult:
    path = Path(fixture_dir)
    expected = load_expected(path)
    actual, timings = analyze_fixture(path)
    return RepoResult(
        name=path.name,
        directory=path,
        match=score(expected, actual),
        findings=actual,
        timings_ms=timings,
    )


def fixture_dirs(root: str | Path = FIXTURES_DIR) -> list[Path]:
    root_path = Path(root)
    if not root_path.is_dir():
        raise FileNotFoundError(f"fixtures directory not found: {root_path}")
    dirs = sorted(path for path in root_path.iterdir() if path.is_dir() and path.name.startswith("repo_"))
    if not dirs:
        raise FileNotFoundError(f"no repo_* fixtures under {root_path}")
    return dirs


def run_all(root: str | Path = FIXTURES_DIR) -> list[RepoResult]:
    return [evaluate_fixture(path) for path in fixture_dirs(root)]


def overall_match(results: Iterable[RepoResult]) -> MatchResult:
    items = list(results)
    return MatchResult(
        correct=tuple(finding for result in items for finding in result.match.correct),
        false_alarms=tuple(finding for result in items for finding in result.match.false_alarms),
        missed=tuple(finding for result in items for finding in result.match.missed),
    )


def _format_timings(timings: dict[str, float]) -> str:
    preferred = [
        "snapshot.git_sha",
        "snapshot.walk",
        "snapshot.total",
        "analyzer.route_security",
        "analyzer.route_security.probe",
        "analyzer.complexity",
        "analyzer.data_mapping",
        "eval.merge",
        "eval.total",
    ]
    keys = [key for key in preferred if key in timings]
    keys.extend(key for key in timings if key not in keys)
    return ", ".join(f"{key}={timings[key]:.1f}ms" for key in keys)


def print_report(results: Sequence[RepoResult], overall: MatchResult) -> None:
    for result in results:
        match = result.match
        print(result.name)
        print(
            f"  correct={match.true_positives} "
            f"false_alarms={match.false_positives} missed={match.false_negatives}"
        )
        for finding in result.findings:
            print(
                f"    found {finding.severity:6} {finding.confidence:.2f} "
                f"{finding.file}:{finding.line} {finding.type}"
            )
        for finding in match.false_alarms:
            print(
                f"    FALSE ALARM {finding.file}:{finding.line} "
                f"{finding.type} ({finding.analyzer})"
            )
        for expected in match.missed:
            suffix = "" if expected.analyzer in IMPLEMENTED_ANALYZERS else " [analyzer not implemented yet]"
            print(
                f"    missed {expected.file}:{expected.line} "
                f"{expected.type} ({expected.analyzer}){suffix}"
            )
        print(f"  timings: {_format_timings(result.timings_ms)}")
        print()

    print(
        f"OVERALL: correct={overall.true_positives} "
        f"false_alarms={overall.false_positives} missed={overall.false_negatives}"
    )
    print(f"precision={overall.precision:.2f} recall={overall.recall:.2f}")
    print(f"BASELINE (rules only, Step 4): {', '.join(sorted(IMPLEMENTED_ANALYZERS))}")


def report_payload(results: Sequence[RepoResult], overall: MatchResult) -> dict[str, Any]:
    return {
        "repos": [
            {
                "name": result.name,
                "correct": result.match.true_positives,
                "false_alarms": result.match.false_positives,
                "missed": result.match.false_negatives,
                "timings_ms": result.timings_ms,
                "findings": [finding.to_dict() for finding in result.findings],
                "missed_findings": [
                    {
                        "analyzer": item.analyzer,
                        "type": item.type,
                        "file": item.file,
                        "line": item.line,
                    }
                    for item in result.match.missed
                ],
            }
            for result in results
        ],
        "overall": {
            "correct": overall.true_positives,
            "false_alarms": overall.false_positives,
            "missed": overall.false_negatives,
            "precision": round(overall.precision, 4),
            "recall": round(overall.recall, 4),
        },
        "implemented_analyzers": sorted(IMPLEMENTED_ANALYZERS),
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the rules-only baseline eval")
    parser.add_argument("--fixtures", type=Path, default=FIXTURES_DIR)
    parser.add_argument("--json", action="store_true", help="print machine-readable results")
    args = parser.parse_args(argv)

    try:
        results = run_all(args.fixtures)
    except (FileNotFoundError, ValueError) as error:
        print(f"eval error: {error}", file=sys.stderr)
        return 2

    overall = overall_match(results)
    if args.json:
        print(json.dumps(report_payload(results, overall), indent=2))
    else:
        print_report(results, overall)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
