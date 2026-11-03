from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from app import settings


def test_settings_defaults_and_environment_cache(aws, monkeypatch):
    for key in ("FREE_RUNS_PER_USER", "MAX_RUNS_PER_DAY", "STALE_DAYS", "SSM_PREFIX"):
        monkeypatch.delenv(key)
    monkeypatch.setenv("OWNER_EMAILS", " OWNER@example.com, , other@example.com ")
    config = settings.get_settings()
    assert config.free_runs_per_user == 1
    assert config.max_runs_per_day == 30
    assert config.stale_days == 90
    assert config.ssm_prefix == "/marketclue"
    assert config.owner_emails == {"owner@example.com", "other@example.com"}
    monkeypatch.setenv("TABLE_NAME", "changed")
    assert settings.get_settings() is config
    assert config.table_name == "marketclue-test"


def test_ssm_secrets_are_decrypted_lazily_and_cached(aws, monkeypatch):
    config = settings.get_settings()
    client = aws["ssm"]
    spy = Mock(wraps=client.get_parameter)
    monkeypatch.setattr(client, "get_parameter", spy)
    monkeypatch.setattr(settings.boto3, "client", Mock(return_value=client))
    assert spy.call_count == 0
    assert config.session_secret == "test-session-secret-at-least-32-bytes"
    client.put_parameter(Name="/marketclue/session_secret", Value="changed", Type="SecureString", Overwrite=True)
    assert config.session_secret == "test-session-secret-at-least-32-bytes"
    spy.assert_called_once_with(Name="/marketclue/session_secret", WithDecryption=True)
    assert config.anthropic_api_key == "test-anthropic-key"
    assert spy.call_count == 2


def test_custom_ssm_prefix_and_missing_secrets_fail(aws, monkeypatch):
    monkeypatch.setenv("SSM_PREFIX", "/other-app/")
    config = settings.get_settings()
    assert config.ssm_prefix == "/other-app"
    with pytest.raises(ClientError):
        _ = config.session_secret
    aws["ssm"].put_parameter(Name="/other-app/session_secret", Value="custom-secret", Type="SecureString")
    assert config.session_secret == "custom-secret"


@pytest.mark.parametrize("key", ["FREE_RUNS_PER_USER", "MAX_RUNS_PER_DAY", "STALE_DAYS"])
@pytest.mark.parametrize("value", ["-1", "invalid"])
def test_invalid_integer_configuration_fails(aws, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    with pytest.raises(ValueError):
        settings.get_settings()
