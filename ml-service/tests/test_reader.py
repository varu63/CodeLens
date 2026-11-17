import subprocess
from pathlib import Path

import pytest

from pipeline.reader import build_snapshot, language_for


def write_file(root: Path, rel: str, content: str | bytes) -> Path:
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content.encode("utf-8") if isinstance(content, str) else content)
    return target


def test_indexes_sorted_text_files_and_detects_language(tmp_path):
    write_file(tmp_path, "src/b.ts", "export const b = 1\n")
    write_file(tmp_path, "src/a.js", "module.exports = 1\n")
    write_file(tmp_path, "README.md", "# hi\n")

    snapshot = build_snapshot(tmp_path)

    assert snapshot.paths() == ["README.md", "src/a.js", "src/b.ts"]
    assert snapshot.paths("javascript") == ["src/a.js"]
    assert snapshot.paths("typescript") == ["src/b.ts"]
    assert language_for("x.tsx") == "typescript"


def test_skips_dependency_and_build_directories(tmp_path):
    write_file(tmp_path, "src/app.js", "const x = 1\n")
    for ignored in ("node_modules", ".git", "dist", "build", ".next"):
        write_file(tmp_path, f"{ignored}/junk.js", "junk\n")

    snapshot = build_snapshot(tmp_path)

    assert snapshot.paths() == ["src/app.js"]
    ignored = [item.path for item in snapshot.skipped if item.reason == "ignored_dir"]
    assert sorted(ignored) == [".git", ".next", "build", "dist", "node_modules"]


def test_skips_files_over_one_megabyte_by_default(tmp_path):
    write_file(tmp_path, "small.js", "ok\n")
    write_file(tmp_path, "big.js", b"x" * (1024 * 1024 + 1))

    snapshot = build_snapshot(tmp_path)

    assert snapshot.paths() == ["small.js"]
    assert [(item.path, item.reason) for item in snapshot.skipped] == [("big.js", "too_large")]


def test_honours_custom_size_cap(tmp_path):
    write_file(tmp_path, "big.js", "x" * 200)

    snapshot = build_snapshot(tmp_path, max_file_bytes=100)

    assert snapshot.paths() == []
    assert snapshot.skipped[0].reason == "too_large"


def test_skips_binary_files(tmp_path):
    write_file(tmp_path, "text.js", "ok\n")
    write_file(tmp_path, "image.bin", b"\x89PNG\x00\x01\x02")

    snapshot = build_snapshot(tmp_path)

    assert snapshot.paths() == ["text.js"]
    assert [(item.path, item.reason) for item in snapshot.skipped] == [("image.bin", "binary")]


def test_caps_file_count_and_marks_truncated(tmp_path):
    for name in ("a.js", "b.js", "c.js", "d.js"):
        write_file(tmp_path, name, "x\n")

    snapshot = build_snapshot(tmp_path, max_files=2)

    assert snapshot.paths() == ["a.js", "b.js"]
    assert snapshot.truncated is True
    assert any(item.reason == "max_files" for item in snapshot.skipped)


def test_time_budget_stops_the_walk(tmp_path):
    write_file(tmp_path, "a.js", "x\n")

    snapshot = build_snapshot(tmp_path, max_seconds=0.0)

    assert snapshot.paths() == []
    assert snapshot.truncated is True
    assert snapshot.skipped[0].reason == "time_budget"


def test_skips_symlinked_files(tmp_path):
    real = write_file(tmp_path, "real.js", "ok\n")
    link = tmp_path / "link.js"
    try:
        link.symlink_to(real)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks are not permitted on this machine")

    snapshot = build_snapshot(tmp_path)

    assert snapshot.paths() == ["real.js"]
    assert any(item.path == "link.js" and item.reason == "symlink" for item in snapshot.skipped)


def test_read_text_is_cached_and_restricted_to_index(tmp_path):
    repo = tmp_path / "repo"
    write_file(repo, "src/a.js", "hello\n")
    outside = write_file(tmp_path, "outside-secret.txt", "secret\n")

    snapshot = build_snapshot(repo)

    assert snapshot.read_text("src/a.js") == "hello\n"
    assert snapshot.read_text("src/a.js") == "hello\n"  # served from cache
    with pytest.raises(FileNotFoundError):
        snapshot.read_text("missing.js")
    with pytest.raises(FileNotFoundError):
        snapshot.read_text("../outside-secret.txt")
    assert outside.exists()


def test_reads_commit_sha_from_git_repo(tmp_path):
    write_file(tmp_path, "a.js", "x\n")
    git = ["git", "-C", str(tmp_path)]
    subprocess.run([*git, "init", "-q"], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run(
        [*git, "-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-qm", "init"],
        check=True,
    )
    expected = subprocess.run([*git, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()

    snapshot = build_snapshot(tmp_path)

    assert snapshot.commit_sha == expected


def test_non_git_directory_has_no_commit_sha(tmp_path):
    write_file(tmp_path, "a.js", "x\n")

    snapshot = build_snapshot(tmp_path)

    assert snapshot.commit_sha is None


def test_records_stage_timings(tmp_path):
    write_file(tmp_path, "a.js", "x\n")

    snapshot = build_snapshot(tmp_path)

    assert snapshot.timings_ms["snapshot.total"] >= snapshot.timings_ms["snapshot.walk"]
    assert snapshot.timings_ms["snapshot.walk"] >= 0
    assert "snapshot.git_sha" in snapshot.timings_ms


def test_rejects_missing_root(tmp_path):
    with pytest.raises(FileNotFoundError):
        build_snapshot(tmp_path / "does-not-exist")


def test_rejects_non_positive_max_files(tmp_path):
    with pytest.raises(ValueError):
        build_snapshot(tmp_path, max_files=0)
