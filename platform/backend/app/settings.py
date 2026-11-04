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
    max_smarter_per_day: int
    ssm_prefix: str
    self_function_name: str
    stale_days: int
    site_origin: str
    region: str
    openai_image_model: str
    openai_image_size: str
    openai_image_quality: str
    ses_from: str
    max_ebay_calls_per_day: int

    @property
    def session_secret(self) -> str:
        return _ssm_parameter(f"{self.ssm_prefix}/session_secret")

    @property
    def anthropic_api_key(self) -> str:
        return _ssm_parameter(f"{self.ssm_prefix}/anthropic_api_key")

    @property
    def openai_api_key(self) -> str | None:
        """None when the optional mock-up key is not configured."""
        return _optional_parameter(f"{self.ssm_prefix}/openai_api_key")

    @property
    def ebay_credentials(self) -> tuple[str, str] | None:
        """(client id, client secret) of the eBay app, or None until both are in SSM."""
        client_id = _optional_parameter(f"{self.ssm_prefix}/ebay_client_id")
        secret = _optional_parameter(f"{self.ssm_prefix}/ebay_client_secret") if client_id else None
        return (client_id, secret) if client_id and secret else None


def _optional_parameter(name: str) -> str | None:
    """An optional SSM value; a missing one is looked up again next time, so adding it needs no redeploy."""
    try:
        return _ssm_parameter(name)
    except ValueError:
        return None
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ParameterNotFound":
            return None
        raise


# Mock-up pictures are capped to keep cost down: no sizes above 1536 px and no "high" quality.
IMAGE_SIZES = ("1024x1024", "1024x1536", "1536x1024")
IMAGE_QUALITIES = ("low", "medium")


def _allowed(name: str, allowed: tuple[str, ...], default: str) -> str:
    """An env value from a fixed list; anything else (including larger sizes) falls back to the default."""
    value = os.environ.get(name, "").strip().lower()
    return value if value in allowed else default


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
        max_smarter_per_day=_nonnegative_int("MAX_SMARTER_PER_DAY", 10),
        ssm_prefix=os.environ.get("SSM_PREFIX", "/marketclue").rstrip("/"),
        self_function_name=os.environ.get("SELF_FUNCTION_NAME", ""),
        stale_days=_nonnegative_int("STALE_DAYS", 90),
        site_origin=os.environ.get("SITE_ORIGIN", "").rstrip("/"),
        region=os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-west-2")),
        openai_image_model=os.environ.get("OPENAI_IMAGE_MODEL", "").strip() or "gpt-image-2",
        openai_image_size=_allowed("OPENAI_IMAGE_SIZE", IMAGE_SIZES, "1024x1024"),
        openai_image_quality=_allowed("OPENAI_IMAGE_QUALITY", IMAGE_QUALITIES, "low"),
        ses_from=os.environ.get("SES_FROM", "").strip(),
        max_ebay_calls_per_day=_nonnegative_int("MAX_EBAY_CALLS_PER_DAY", 1000),
    )
