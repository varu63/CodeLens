"""Wall-clock timing for every pipeline stage.

A run builds one TimingLog, passes it to each stage, and at the end logs the
summary (snapshot, each analyzer, embeddings, LLM) so slow steps are visible.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Iterator

logger = logging.getLogger("proofloop.timing")


@dataclass
class TimingLog:
    entries: dict[str, float] = field(default_factory=dict)

    def record(self, name: str, elapsed_ms: float) -> None:
        """Add one measurement; repeating a stage name accumulates its time."""
        ms = round(max(0.0, float(elapsed_ms)), 1)
        self.entries[name] = round(self.entries.get(name, 0.0) + ms, 1)

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        start = time.perf_counter()
        try:
            yield
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000
            self.record(name, elapsed_ms)
            logger.info("stage=%s elapsed_ms=%.1f", name, elapsed_ms)

    def as_dict(self) -> dict[str, float]:
        return dict(self.entries)

    def summary(self) -> str:
        return ", ".join(f"{name}={ms:.1f}ms" for name, ms in self.entries.items())

    def log_summary(self, label: str = "run") -> None:
        logger.info("%s timings: %s", label, self.summary() or "no stages recorded")
