"""The one finding shape every analyzer returns, plus the merge rules.

Merge steps, in order:
1. Raise confidence when more than one analyzer flags the same file.
2. Remove duplicates by (file, line, type), keeping the highest confidence.
3. Sort by severity (high first), then confidence (highest first).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Iterable, Literal

Severity = Literal["low", "medium", "high"]

_SEVERITY_RANK: dict[str, int] = {"high": 0, "medium": 1, "low": 2}
_CONFIDENCE_BOOST_PER_EXTRA_ANALYZER = 0.1


@dataclass(frozen=True)
class Finding:
    analyzer: str
    type: str
    severity: Severity
    confidence: float
    file: str
    line: int
    message: str
    fix_hint: str

    def __post_init__(self) -> None:
        for field_name in ("analyzer", "type", "file", "message"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"{field_name} must be a non-empty string")
        if self.severity not in _SEVERITY_RANK:
            raise ValueError(f"severity must be low, medium or high, got {self.severity!r}")
        if not isinstance(self.confidence, (int, float)) or not 0 <= self.confidence <= 1:
            raise ValueError(f"confidence must be between 0 and 1, got {self.confidence!r}")
        if not isinstance(self.line, int) or self.line < 1:
            raise ValueError(f"line must be a positive integer, got {self.line!r}")
        if not isinstance(self.fix_hint, str):
            raise ValueError("fix_hint must be a string")

    def to_dict(self) -> dict[str, object]:
        return {
            "analyzer": self.analyzer,
            "type": self.type,
            "severity": self.severity,
            "confidence": round(float(self.confidence), 2),
            "file": self.file,
            "line": self.line,
            "message": self.message,
            "fix_hint": self.fix_hint,
        }


def merge_findings(findings: Iterable[Finding]) -> list[Finding]:
    """Apply the project merge rules without mutating the inputs."""
    items = list(findings)
    if not items:
        return []

    analyzers_by_file: dict[str, set[str]] = {}
    for finding in items:
        analyzers_by_file.setdefault(finding.file, set()).add(finding.analyzer)

    boosted: list[Finding] = []
    for finding in items:
        extra_analyzers = len(analyzers_by_file[finding.file]) - 1
        if extra_analyzers > 0:
            confidence = finding.confidence + _CONFIDENCE_BOOST_PER_EXTRA_ANALYZER * extra_analyzers
            finding = replace(finding, confidence=round(min(1.0, confidence), 2))
        boosted.append(finding)

    best_by_location: dict[tuple[str, int, str], Finding] = {}
    for finding in sorted(boosted, key=lambda item: (-item.confidence, item.analyzer, item.message)):
        key = (finding.file, finding.line, finding.type)
        best_by_location.setdefault(key, finding)

    return sorted(
        best_by_location.values(),
        key=lambda item: (
            _SEVERITY_RANK[item.severity],
            -item.confidence,
            item.file,
            item.line,
            item.type,
            item.analyzer,
        ),
    )
