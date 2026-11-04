"""Optional mock-up pictures for a finished report, made with the OpenAI Images API."""

import base64

import openai

from .settings import get_settings

KINDS = ("product", "listing", "ad")
MAX_PER_RUN = 3
LABEL = "AI mock-up — not a real product photo"

SCENES = {
    "product": "a realistic studio product photo of {business}, on a plain light background in soft daylight",
    "listing": "the main photo of an online shop listing for {business}, styled the way buyers of it expect",
    "ad": "a simple social media ad picture for {business}, made for {customer}, with calm space for a headline",
}


def _clean(value, limit=200):
    return " ".join(str(value or "").split())[:limit]


def build_prompt(kind, run, result):
    brief = (result or {}).get("brief") or run.get("brief") or {}
    business = _clean(brief.get("business")) or _clean(run.get("title")) or "a small business product"
    customer = _clean(brief.get("customer")) or "its customers"
    scene = SCENES[kind].format(business=business, customer=customer)
    return (
        f"Concept mock-up for a solo founder: {scene}. No words, no logos, no brand names and no real "
        "people's faces. It shows an idea, not a real product."
    )


def _content_type(image):
    if image.startswith(b"\x89PNG"):
        return "image/png"
    if image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        return "image/webp"
    return "image/jpeg"


def generate(api_key, prompt):
    """Returns (image bytes, content type) for one 1024x1024 picture."""
    client = openai.OpenAI(api_key=api_key, max_retries=1, timeout=120)
    response = client.images.generate(
        model=get_settings().openai_image_model, prompt=prompt, n=1, size="1024x1024",
        quality="medium", output_format="jpeg",
    )
    data = response.data[0].b64_json if response.data else None
    if not data:
        raise RuntimeError("The image service returned no picture")
    image = base64.b64decode(data)
    return image, _content_type(image)
