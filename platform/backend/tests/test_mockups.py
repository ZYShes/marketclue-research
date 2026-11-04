import base64
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import mockups, settings, store
from helpers import BRIEF, body, done_run, image, request, signed_in


JPEG = b"\xff\xd8\xff\xe0fake-jpeg"


@pytest.fixture
def openai_key(aws):
    aws["ssm"].put_parameter(Name="/marketclue/openai_api_key", Value="test-openai-key", Type="SecureString")


@pytest.fixture
def generate(monkeypatch):
    fake = Mock(return_value=(JPEG, "image/jpeg"))
    monkeypatch.setattr(mockups, "generate", fake)
    return fake


@pytest.fixture
def owner_run(aws):
    session = signed_in("owner", "owner@example.com", "Owner")
    return session, done_run("owner")


def test_mockup_routes_require_session(aws):
    for path, method in [("/api/runs/x/mockup", "POST"), ("/api/runs/x/mockups", "GET"), ("/api/runs/x/mockups/y", "GET")]:
        assert request(path, method, {})["statusCode"] == 401


def test_mockups_are_disabled_without_the_openai_key(owner_run, generate):
    session, run = owner_run
    response = request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": "product"}, session)
    assert response["statusCode"] == 503
    assert body(response)["error"]["code"] == "mockups_disabled"
    listed = body(request(f"/api/runs/{run['run_id']}/mockups", session=session))
    assert listed == {"mockups": [], "enabled": False, "limit": 3, "remaining": 3}
    generate.assert_not_called()


def test_openai_key_setting_is_optional(aws):
    assert settings.get_settings().openai_api_key is None
    aws["ssm"].put_parameter(Name="/marketclue/openai_api_key", Value="key", Type="SecureString")
    assert settings.get_settings().openai_api_key == "key"


def test_owner_makes_lists_and_views_a_mockup(owner_run, openai_key, generate, aws):
    session, run = owner_run
    response = request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": "listing"}, session)
    assert response["statusCode"] == 201
    made = body(response)
    assert set(made) == {"mockup_id", "prompt_kind", "prompt", "created_at", "label", "url"}
    assert made["url"] == f"/api/runs/{run['run_id']}/mockups/{made['mockup_id']}"
    assert made["label"] == "AI mock-up — not a real product photo"
    assert BRIEF["business"] in made["prompt"] and "No words, no logos" in made["prompt"]
    generate.assert_called_once_with("test-openai-key", made["prompt"])
    stored = aws["s3"].get_object(Bucket=aws["bucket"], Key=f"mockups/{run['run_id']}/{made['mockup_id']}.jpg")
    assert stored["Body"].read() == JPEG and stored["ContentType"] == "image/jpeg"
    listed = body(request(f"/api/runs/{run['run_id']}/mockups", session=session))
    assert listed == {"mockups": [made], "enabled": True, "limit": 3, "remaining": 2}
    picture = request(made["url"], session=session)
    assert picture["statusCode"] == 200
    assert picture["headers"]["content-type"] == "image/jpeg"
    assert image(picture) == JPEG
    assert request(f"/api/runs/{run['run_id']}/mockups/missing", session=session)["statusCode"] == 404


def test_at_most_three_mockups_per_run(owner_run, openai_key, generate):
    session, run = owner_run
    for kind in mockups.KINDS:
        assert request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": kind}, session)["statusCode"] == 201
    response = request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": "ad"}, session)
    assert response["statusCode"] == 429
    assert body(response)["error"]["code"] == "mockup_limit"
    assert generate.call_count == 3
    assert body(request(f"/api/runs/{run['run_id']}/mockups", session=session))["remaining"] == 0


def test_failed_generation_releases_the_slot(owner_run, openai_key, generate):
    session, run = owner_run
    generate.side_effect = RuntimeError("content policy")
    response = request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": "ad"}, session)
    assert response["statusCode"] == 502
    assert body(response)["error"]["code"] == "mockup_failed"
    assert store.get_run(run["run_id"])["mockup_count"] == 0
    generate.side_effect = None
    for _ in range(3):
        assert request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": "ad"}, session)["statusCode"] == 201


def test_mockup_rules(owner_run, openai_key, generate):
    session, run = owner_run
    for kind in (None, "poster", 3, ["ad"]):
        response = request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": kind}, session)
        assert response["statusCode"] == 400 and body(response)["error"]["code"] == "invalid_prompt_kind"
    running = store.create_run("owner", "conversation", "Running", BRIEF)
    response = request(f"/api/runs/{running['run_id']}/mockup", "POST", {"prompt_kind": "ad"}, session)
    assert response["statusCode"] == 409 and body(response)["error"]["code"] == "run_not_done"
    founder = signed_in()
    own = done_run("founder")
    response = request(f"/api/runs/{own['run_id']}/mockup", "POST", {"prompt_kind": "ad"}, founder)
    assert response["statusCode"] == 403 and body(response)["error"]["code"] == "mockups_owner_only"
    assert request(f"/api/runs/{run['run_id']}/mockup", "POST", {"prompt_kind": "ad"}, founder)["statusCode"] == 404
    assert request(f"/api/runs/{run['run_id']}/mockups", session=founder)["statusCode"] == 404
    generate.assert_not_called()


def test_generate_uses_the_openai_images_api(aws, monkeypatch):
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-test")
    settings.get_settings.cache_clear()
    png = b"\x89PNG\r\n\x1a\nfake"
    client = Mock()
    client.images.generate.return_value = SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(png).decode())])
    constructor = Mock(return_value=client)
    monkeypatch.setattr(mockups.openai, "OpenAI", constructor)
    assert mockups.generate("secret", "A mug") == (png, "image/png")
    assert constructor.call_args.kwargs["api_key"] == "secret"
    arguments = client.images.generate.call_args.kwargs
    assert arguments["model"] == "gpt-image-test" and arguments["prompt"] == "A mug"
    assert arguments["n"] == 1 and arguments["size"] == "1024x1024" and arguments["quality"] == "low"
    client.images.generate.return_value = SimpleNamespace(data=[SimpleNamespace(b64_json=None)])
    with pytest.raises(RuntimeError):
        mockups.generate("secret", "A mug")


def test_default_image_model_and_prompts(aws):
    assert settings.get_settings().openai_image_model == "gpt-image-2"
    run = {"title": "Fallback title", "brief": {}}
    for kind in mockups.KINDS:
        prompt = mockups.build_prompt(kind, run, None)
        assert "Fallback title" in prompt and "not a real product" in prompt
    prompt = mockups.build_prompt("ad", run, {"brief": {"business": "Tea\n  cups", "customer": "Students"}})
    assert "Tea cups" in prompt and "Students" in prompt


@pytest.mark.parametrize(("size", "quality", "expected"), [
    ("1536x1024", "medium", ("1536x1024", "medium")),
    ("4096x4096", "high", ("1024x1024", "low")),
    ("auto", "HIGH", ("1024x1024", "low")),
    ("", "", ("1024x1024", "low")),
])
def test_image_size_and_quality_are_capped(aws, monkeypatch, size, quality, expected):
    monkeypatch.setenv("OPENAI_IMAGE_SIZE", size)
    monkeypatch.setenv("OPENAI_IMAGE_QUALITY", quality)
    settings.get_settings.cache_clear()
    try:
        current = settings.get_settings()
        assert (current.openai_image_size, current.openai_image_quality) == expected
    finally:
        settings.get_settings.cache_clear()
