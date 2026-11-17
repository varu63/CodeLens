import logging

import pytest

from pipeline.timing import TimingLog


def test_stage_records_elapsed_time():
    log = TimingLog()
    with log.stage("snapshot.walk"):
        pass

    assert "snapshot.walk" in log.entries
    assert log.entries["snapshot.walk"] >= 0


def test_repeated_stage_names_accumulate():
    log = TimingLog()
    log.record("embeddings", 10)
    log.record("embeddings", 5)
    assert log.entries["embeddings"] == 15


def test_stage_records_even_when_body_raises():
    log = TimingLog()
    with pytest.raises(RuntimeError):
        with log.stage("analyzer.route_security"):
            raise RuntimeError("boom")

    assert "analyzer.route_security" in log.entries


def test_summary_and_dict_are_copy():
    log = TimingLog()
    log.record("llm", 2.5)
    snapshot = log.as_dict()
    snapshot["llm"] = 999

    assert "llm=2.5ms" in log.summary()
    assert log.entries["llm"] == 2.5


def test_log_summary_emits_line(caplog):
    log = TimingLog()
    log.record("snapshot.total", 1)
    with caplog.at_level(logging.INFO, logger="proofloop.timing"):
        log.log_summary("run")
    assert "run timings" in caplog.text
