"""One-pass repository snapshot shared by every analyzer.

The walk is read-only and bounded: it skips dependency/build folders, files
over 1 MB, binaries and symlinks, and stops at a file cap or time budget. Text
is read lazily and cached, so analyzers see one consistent view of the repo.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Literal

from pipeline.timing import TimingLog

logger = logging.getLogger("proofloop.reader")

IGNORED_DIR_NAMES: frozenset[str] = frozenset({"node_modules", ".git", "dist", "build", ".next"})

DEFAULT_MAX_FILES = 5000
DEFAULT_MAX_FILE_BYTES = 1_048_576
DEFAULT_MAX_SECONDS = 60.0
BINARY_SNIFF_BYTES = 8192

_LANGUAGE_BY_SUFFIX: dict[str, str] = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".json": "json",
    ".py": "python",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cs": "csharp",
    ".rs": "rust",
    ".swift": "swift",
    ".kt": "kotlin",
    ".sql": "sql",
    ".sh": "shell",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".html": "html",
    ".css": "css",
    ".scss": "css",
    ".md": "markdown",
}

SkipReason = Literal[
    "ignored_dir",
    "too_large",
    "binary",
    "max_files",
    "time_budget",
    "symlink",
    "unreadable",
]


@dataclass(frozen=True)
class FileEntry:
    """One indexed file; path is POSIX-style and relative to the snapshot root."""

    path: str
    size: int
    language: str | None


@dataclass(frozen=True)
class SkippedFile:
    path: str
    reason: SkipReason


@dataclass
class Snapshot:
    root: Path
    commit_sha: str | None
    files: list[FileEntry]
    skipped: list[SkippedFile]
    timings_ms: dict[str, float]
    truncated: bool
    _index: dict[str, FileEntry] = field(init=False, repr=False)
    _text_cache: dict[str, str] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        self._index = {entry.path: entry for entry in self.files}

    def __len__(self) -> int:
        return len(self.files)

    def paths(self, language: str | None = None) -> list[str]:
        if language is None:
            return [entry.path for entry in self.files]
        return [entry.path for entry in self.files if entry.language == language]

    def read_text(self, path: str) -> str:
        """Return cached UTF-8 text for an indexed path; reject anything else."""
        if path not in self._index:
            raise FileNotFoundError(f"{path!r} is not part of this snapshot")

        cached = self._text_cache.get(path)
        if cached is not None:
            return cached

        target = (self.root / path).resolve()
        try:
            target.relative_to(self.root)
        except ValueError as error:
            raise ValueError(f"{path!r} escapes the snapshot root") from error

        text = target.read_bytes().decode("utf-8", errors="replace")
        self._text_cache[path] = text
        return text

    def skipped_by_reason(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for item in self.skipped:
            counts[item.reason] = counts.get(item.reason, 0) + 1
        return counts


def language_for(path: str) -> str | None:
    return _LANGUAGE_BY_SUFFIX.get(Path(path).suffix.lower())


def _relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _read_commit_sha(root: Path, timeout_seconds: float = 2.0) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    sha = result.stdout.strip()
    return sha or None


def _is_binary(path: Path) -> bool:
    with path.open("rb") as handle:
        chunk = handle.read(BINARY_SNIFF_BYTES)
    return b"\x00" in chunk


def build_snapshot(
    root: str | Path,
    *,
    max_files: int = DEFAULT_MAX_FILES,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    max_seconds: float = DEFAULT_MAX_SECONDS,
    ignored_dir_names: Iterable[str] = IGNORED_DIR_NAMES,
    timing: TimingLog | None = None,
) -> Snapshot:
    """Walk a repository once and return the shared snapshot."""
    if max_files <= 0:
        raise ValueError("max_files must be positive")

    root_path = Path(root).resolve()
    if not root_path.is_dir():
        raise FileNotFoundError(f"snapshot root is not a directory: {root_path}")

    timings = timing or TimingLog()
    ignored = set(ignored_dir_names)
    files: list[FileEntry] = []
    skipped: list[SkippedFile] = []
    truncated = False
    started = time.perf_counter()

    with timings.stage("snapshot.git_sha"):
        commit_sha = _read_commit_sha(root_path)

    walk_started = time.perf_counter()
    for dirpath, dirnames, filenames in os.walk(root_path, topdown=True, followlinks=False):
        current = Path(dirpath)

        kept_dirs: list[str] = []
        for name in sorted(dirnames):
            child = current / name
            if name in ignored:
                skipped.append(SkippedFile(_relative(root_path, child), "ignored_dir"))
                continue
            if child.is_symlink():
                skipped.append(SkippedFile(_relative(root_path, child), "symlink"))
                continue
            kept_dirs.append(name)
        dirnames[:] = kept_dirs

        for name in sorted(filenames):
            if time.perf_counter() - started > max_seconds:
                skipped.append(SkippedFile(_relative(root_path, current / name), "time_budget"))
                truncated = True
                break
            if len(files) >= max_files:
                skipped.append(SkippedFile(_relative(root_path, current / name), "max_files"))
                truncated = True
                break

            candidate = current / name
            rel = _relative(root_path, candidate)

            if candidate.is_symlink():
                skipped.append(SkippedFile(rel, "symlink"))
                continue
            try:
                stat = candidate.stat()
            except OSError:
                skipped.append(SkippedFile(rel, "unreadable"))
                continue
            if not candidate.is_file():
                continue
            if stat.st_size > max_file_bytes:
                skipped.append(SkippedFile(rel, "too_large"))
                continue
            try:
                if _is_binary(candidate):
                    skipped.append(SkippedFile(rel, "binary"))
                    continue
            except OSError:
                skipped.append(SkippedFile(rel, "unreadable"))
                continue

            files.append(FileEntry(path=rel, size=stat.st_size, language=language_for(rel)))

        if truncated:
            break

    timings.record("snapshot.walk", (time.perf_counter() - walk_started) * 1000)
    timings.record("snapshot.total", (time.perf_counter() - started) * 1000)

    snapshot = Snapshot(
        root=root_path,
        commit_sha=commit_sha,
        files=files,
        skipped=skipped,
        timings_ms=timings.as_dict(),
        truncated=truncated,
    )
    timings.log_summary("snapshot")
    logger.info(
        "snapshot files=%d skipped=%s truncated=%s sha=%s",
        len(snapshot),
        snapshot.skipped_by_reason(),
        truncated,
        commit_sha,
    )
    return snapshot


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: python -m pipeline.reader <repo-root>", file=sys.stderr)
        return 2

    snapshot = build_snapshot(args[0])
    print(
        json.dumps(
            {
                "root": str(snapshot.root),
                "commit_sha": snapshot.commit_sha,
                "files": len(snapshot),
                "bytes": sum(entry.size for entry in snapshot.files),
                "truncated": snapshot.truncated,
                "skipped": snapshot.skipped_by_reason(),
                "timings_ms": snapshot.timings_ms,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
