from app.settings import Settings


def test_defaults_match_the_project_spec():
    settings = Settings(_env_file=None)

    assert settings.embed_model == "sentence-transformers/all-MiniLM-L6-v2"
    assert settings.code_embed_model == "microsoft/unixcoder-base"
    assert settings.llm_model == "qwen2.5-coder:1.5b"
    assert settings.stage_timeout_seconds == 60
    assert settings.snapshot_max_file_bytes == 1024 * 1024


def test_environment_overrides_are_read(monkeypatch):
    monkeypatch.setenv("EMBED_MODEL", "custom/mini")
    monkeypatch.setenv("SNAPSHOT_MAX_FILE_MB", "2")

    settings = Settings(_env_file=None)

    assert settings.embed_model == "custom/mini"
    assert settings.snapshot_max_file_bytes == 2 * 1024 * 1024
