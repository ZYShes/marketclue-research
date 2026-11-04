import os
from dataclasses import dataclass
from functools import lru_cache

import boto3
from botocore.exceptions import ClientError


@lru_cache(maxsize=None)
def _ssm_parameter(name: str) -> str:
    parameter = boto3.client("ssm", region_name=get_settings().region).get_parameter(
        Name=name, WithDecryption=True
    )
    value = parameter["Parameter"]["Value"]
    if not value:
        raise ValueError(f"SSM parameter {name} is empty")
    return value


@dataclass(frozen=True)
class Settings:
    table_name: str
    data_bucket: str
    google_client_id: str
    owner_emails: frozenset[str]
    free_runs_per_user: int
    max_runs_per_day: int
    ssm_prefix: str
    self_function_name: str
    stale_days: int
    site_origin: str
    region: str
    openai_image_model: str
    ses_from: str

    @property
    def session_secret(self) -> str:
        return _ssm_parameter(f"{self.ssm_prefix}/session_secret")

    @property
    def anthropic_api_key(self) -> str:
        return _ssm_parameter(f"{self.ssm_prefix}/anthropic_api_key")

    @property
    def openai_api_key(self) -> str | None:
        """None when the optional mock-up key is not configured."""
        try:
            return _ssm_parameter(f"{self.ssm_prefix}/openai_api_key")
        except ValueError:
            return None
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "ParameterNotFound":
                return None
            raise


def _nonnegative_int(name: str, default: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if value < 0:
        raise ValueError(f"{name} must be nonnegative")
    return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        table_name=os.environ.get("TABLE_NAME", "marketclue"),
        data_bucket=os.environ.get("DATA_BUCKET", ""),
        google_client_id=os.environ.get("GOOGLE_CLIENT_ID", ""),
        owner_emails=frozenset(
            email.strip().lower()
            for email in os.environ.get("OWNER_EMAILS", "").split(",")
            if email.strip()
        ),
        free_runs_per_user=_nonnegative_int("FREE_RUNS_PER_USER", 1),
        max_runs_per_day=_nonnegative_int("MAX_RUNS_PER_DAY", 30),
        ssm_prefix=os.environ.get("SSM_PREFIX", "/marketclue").rstrip("/"),
        self_function_name=os.environ.get("SELF_FUNCTION_NAME", ""),
        stale_days=_nonnegative_int("STALE_DAYS", 90),
        site_origin=os.environ.get("SITE_ORIGIN", "").rstrip("/"),
        region=os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-west-2")),
        openai_image_model=os.environ.get("OPENAI_IMAGE_MODEL", "").strip() or "gpt-image-1",
        ses_from=os.environ.get("SES_FROM", "").strip(),
    )
