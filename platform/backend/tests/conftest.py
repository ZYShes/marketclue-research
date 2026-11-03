import socket
import sys
from pathlib import Path

import boto3
import pytest
from moto import mock_aws


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Network access is forbidden in tests")

    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket.socket, "connect_ex", blocked)
    monkeypatch.setattr(socket, "getaddrinfo", blocked)


def _clear_caches():
    from app import auth, router, settings, store

    for function in (
        settings.get_settings, settings._ssm_parameter, auth._jwks_client,
        router._lambda_client, store._table, store._s3,
    ):
        clear = getattr(function, "cache_clear", None)
        if clear:
            clear()


@pytest.fixture
def aws(monkeypatch):
    values = {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_DEFAULT_REGION": "us-west-2",
        "AWS_REGION": "us-west-2",
        "AWS_EC2_METADATA_DISABLED": "true",
        "TABLE_NAME": "marketclue-test",
        "DATA_BUCKET": "marketclue-test-data",
        "GOOGLE_CLIENT_ID": "test-google-client",
        "OWNER_EMAILS": "owner@example.com",
        "FREE_RUNS_PER_USER": "1",
        "MAX_RUNS_PER_DAY": "30",
        "SSM_PREFIX": "/marketclue",
        "SELF_FUNCTION_NAME": "marketclue-api",
        "STALE_DAYS": "90",
        "SITE_ORIGIN": "https://marketclue.example",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    _clear_caches()
    with mock_aws():
        table = boto3.resource("dynamodb").create_table(
            TableName=values["TABLE_NAME"],
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        s3 = boto3.client("s3")
        s3.create_bucket(Bucket=values["DATA_BUCKET"], CreateBucketConfiguration={"LocationConstraint": "us-west-2"})
        ssm = boto3.client("ssm")
        for name, value in {
            "session_secret": "test-session-secret-at-least-32-bytes",
            "anthropic_api_key": "test-anthropic-key",
        }.items():
            ssm.put_parameter(Name=f"/marketclue/{name}", Value=value, Type="SecureString")
        yield {"table": table, "s3": s3, "ssm": ssm, "bucket": values["DATA_BUCKET"]}
    _clear_caches()
