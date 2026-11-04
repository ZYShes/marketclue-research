from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import boto3
from botocore.exceptions import ClientError

from . import store
from .settings import get_settings


class QuotaError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass
class RunReservation:
    user_sub: str
    day_key: str
    smarter: bool = False
    released: bool = False


def _is_owner(user: dict) -> bool:
    return user.get("email", "").strip().lower() in get_settings().owner_emails


def free_runs_left(user: dict) -> int | None:
    if _is_owner(user):
        return None
    return max(0, get_settings().free_runs_per_user - int(user.get("runs_started", 0)))


def _free_run_used() -> QuotaError:
    return QuotaError(402, "free_run_used", "Your free research runs have been used.")


def _daily_limit() -> QuotaError:
    return QuotaError(429, "daily_limit", "The daily research limit has been reached. Try again tomorrow.")


def _smarter_limit() -> QuotaError:
    return QuotaError(429, "smarter_daily_limit", "Today's Smarter research runs are used up. Quick research is still available.")


def reserve_run(user: dict, smarter: bool = False) -> RunReservation:
    """Atomically counts one run against the user's free runs, the site's daily limit and, for a
    Smarter run, the site-wide daily Smarter limit (MAX_SMARTER_PER_DAY, owners included)."""
    settings = get_settings()
    owner = _is_owner(user)
    if not owner and settings.free_runs_per_user < 1:
        raise _free_run_used()
    if settings.max_runs_per_day < 1:
        raise _daily_limit()
    if smarter and settings.max_smarter_per_day < 1:
        raise _smarter_limit()

    sub = user["sub"]
    now = datetime.now(UTC)
    day_key = f"DAY#{now.date().isoformat()}"
    expiry = int((now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=3)).timestamp())
    profile_values = {":zero": {"N": "0"}, ":one": {"N": "1"}}
    profile_condition = "attribute_exists(#pk)"
    if not owner:
        profile_condition += " AND (attribute_not_exists(#runs) OR #runs < :limit)"
        profile_values[":limit"] = {"N": str(settings.free_runs_per_user)}

    try:
        boto3.client("dynamodb", region_name=settings.region).transact_write_items(
            TransactItems=[
                {"Update": {
                    "TableName": settings.table_name,
                    "Key": {"PK": {"S": f"USER#{sub}"}, "SK": {"S": "PROFILE"}},
                    "UpdateExpression": "SET #runs = if_not_exists(#runs, :zero) + :one",
                    "ConditionExpression": profile_condition,
                    "ExpressionAttributeNames": {"#runs": "runs_started", "#pk": "PK"},
                    "ExpressionAttributeValues": profile_values,
                }},
                {"Update": {
                    "TableName": settings.table_name,
                    "Key": {"PK": {"S": day_key}, "SK": {"S": "COUNTER"}},
                    "UpdateExpression": "SET #runs = if_not_exists(#runs, :zero) + :one, #ttl = :ttl",
                    "ConditionExpression": "attribute_not_exists(#runs) OR #runs < :limit",
                    "ExpressionAttributeNames": {"#runs": "runs", "#ttl": "ttl"},
                    "ExpressionAttributeValues": {
                        ":zero": {"N": "0"}, ":one": {"N": "1"},
                        ":limit": {"N": str(settings.max_runs_per_day)},
                        ":ttl": {"N": str(expiry)},
                    },
                }},
            ] + ([{"Update": {
                "TableName": settings.table_name,
                "Key": {"PK": {"S": day_key}, "SK": {"S": "SMARTER"}},
                "UpdateExpression": "SET #runs = if_not_exists(#runs, :zero) + :one, #ttl = :ttl",
                "ConditionExpression": "attribute_not_exists(#runs) OR #runs < :limit",
                "ExpressionAttributeNames": {"#runs": "runs", "#ttl": "ttl"},
                "ExpressionAttributeValues": {
                    ":zero": {"N": "0"}, ":one": {"N": "1"},
                    ":limit": {"N": str(settings.max_smarter_per_day)},
                    ":ttl": {"N": str(expiry)},
                },
            }}] if smarter else [])
        )
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "TransactionCanceledException":
            raise
        reasons = exc.response.get("CancellationReasons", [])
        if reasons and reasons[0].get("Code") == "ConditionalCheckFailed":
            if store.get_user(sub) is None:
                raise QuotaError(401, "unauthorized", "Sign in is required.") from exc
            if not owner:
                raise _free_run_used() from exc
        if len(reasons) > 1 and reasons[1].get("Code") == "ConditionalCheckFailed":
            raise _daily_limit() from exc
        if len(reasons) > 2 and reasons[2].get("Code") == "ConditionalCheckFailed":
            raise _smarter_limit() from exc
        raise
    return RunReservation(sub, day_key, smarter=smarter)


def release_run(reservation: RunReservation) -> None:
    if reservation.released:
        return
    settings = get_settings()
    boto3.client("dynamodb", region_name=settings.region).transact_write_items(
        TransactItems=[
            {"Update": {
                "TableName": settings.table_name,
                "Key": {"PK": {"S": pk}, "SK": {"S": sk}},
                "UpdateExpression": "SET #runs = #runs - :one",
                "ConditionExpression": "#runs >= :one",
                "ExpressionAttributeNames": {"#runs": field},
                "ExpressionAttributeValues": {":one": {"N": "1"}},
            }}
            for pk, sk, field in [
                (f"USER#{reservation.user_sub}", "PROFILE", "runs_started"),
                (reservation.day_key, "COUNTER", "runs"),
            ] + ([(reservation.day_key, "SMARTER", "runs")] if reservation.smarter else [])
        ]
    )
    reservation.released = True


def check_chat_limits(sub: str, conv: dict, is_new: bool) -> None:
    if is_new and store.count_conversations(sub) >= 20:
        raise QuotaError(429, "conversation_limit", "You can create at most 20 conversations.")
    if len(conv.get("messages", [])) + 2 > 30:
        raise QuotaError(429, "message_limit", "This conversation has reached its 30-message limit.")
