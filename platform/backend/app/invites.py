"""Team invite emails through Amazon SES (only when SES_FROM is configured)."""

import logging

import boto3

from .settings import get_settings


logger = logging.getLogger(__name__)


def send_invite(to, team_name, inviter_name, invite_url) -> bool:
    settings = get_settings()
    if not settings.ses_from:
        return False
    body = (
        f"{inviter_name} invited you to the team \"{team_name}\" on MarketClue.\n\n"
        f"Open this link and sign in with Google as {to} to join:\n{invite_url}\n\n"
        "The link works for 7 days. Team members share finished reports and fact cards; "
        "conversations stay private.\n"
    )
    try:
        boto3.client("sesv2", region_name=settings.region).send_email(
            FromEmailAddress=settings.ses_from,
            Destination={"ToAddresses": [to]},
            Content={"Simple": {
                "Subject": {"Data": f"Join {team_name} on MarketClue", "Charset": "UTF-8"},
                "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
            }},
        )
    except Exception as exc:
        logger.error("Invite email failed: %s", type(exc).__name__)
        return False
    return True
