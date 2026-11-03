import time
from functools import lru_cache
from http.cookies import CookieError, SimpleCookie

import jwt

from .settings import get_settings


GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
SESSION_SECONDS = 7 * 24 * 60 * 60
COOKIE_NAME = "mc_session"
COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/"


class AuthError(Exception):
    pass


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(GOOGLE_JWKS_URL, cache_jwk_set=True, lifespan=3600, timeout=10)


def verify_google_token(credential: str) -> dict:
    client_id = get_settings().google_client_id
    if not client_id:
        raise RuntimeError("GOOGLE_CLIENT_ID is required")
    try:
        if jwt.get_unverified_header(credential).get("alg") != "RS256":
            raise AuthError("Invalid Google credential")
        key = _jwks_client().get_signing_key_from_jwt(credential).key
        claims = jwt.decode(
            credential,
            key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=["accounts.google.com", "https://accounts.google.com"],
            options={
                "require": ["sub", "email", "email_verified", "exp", "iss", "aud"],
                "strict_aud": True,
            },
        )
    except jwt.PyJWTError as exc:
        raise AuthError("Invalid Google credential") from exc
    if (
        claims["email_verified"] is not True
        or not isinstance(claims["sub"], str)
        or not claims["sub"]
        or not isinstance(claims["email"], str)
        or not claims["email"].strip()
    ):
        raise AuthError("Invalid Google credential")
    return claims


def create_session(user: dict) -> str:
    return jwt.encode(
        {"sub": user["sub"], "email": user["email"], "exp": int(time.time()) + SESSION_SECONDS},
        get_settings().session_secret,
        algorithm="HS256",
    )


def session_cookie(user: dict) -> str:
    return f"{COOKIE_NAME}={create_session(user)}; {COOKIE_ATTRIBUTES}"


def clear_session_cookie() -> str:
    return (
        f"{COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; "
        f"{COOKIE_ATTRIBUTES}"
    )


def get_session(event: dict) -> dict | None:
    values = list(event.get("cookies") or [])
    for key, value in (event.get("headers") or {}).items():
        if key.lower() in {"cookie", "cookies"} and isinstance(value, str):
            values.append(value)
    tokens = []
    try:
        for value in values:
            cookie = SimpleCookie()
            cookie.load(value)
            if COOKIE_NAME in cookie:
                tokens.append(cookie[COOKIE_NAME].value)
        if not tokens or len(set(tokens)) != 1:
            return None
        claims = jwt.decode(
            tokens[0],
            get_settings().session_secret,
            algorithms=["HS256"],
            options={"require": ["sub", "email", "exp"]},
        )
    except (CookieError, jwt.PyJWTError, TypeError):
        return None
    if not all(isinstance(claims[key], str) and claims[key] for key in ("sub", "email")):
        return None
    return claims
