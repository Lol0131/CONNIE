"""Gemini: turns a verdict + the user's slider setting into Connie's voice.

Uses structured output (response_schema), so Gemini returns typed JSON that
maps straight onto the API response. app.py falls back to the templates in
rules.py if this raises.
"""
import os
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

MODEL = os.getenv("GEMINI_MODEL", "gemini-flash-latest")
# Tried when the main model is overloaded (503) or erroring.
BACKUP_MODEL = os.getenv("GEMINI_BACKUP_MODEL", "gemini-flash-lite-latest")

_client = None


def client() -> genai.Client:
    # Created lazily so the server still boots (on fallbacks) without a key.
    global _client
    if _client is None:
        _client = genai.Client(
            api_key=os.environ["GEMINI_API_KEY"],
            http_options=types.HttpOptions(timeout=10_000),
        )
    return _client


CONNIE_PERSONA = """You are Connie, a small, warm, slightly bubbly character who
lives in the user's browser and helps them use AI tools mindfully. You sound
like a smart friend giving a heads-up, never like an alarm or a legal notice.
Keep it short, plain English, no jargon, no emojis, no markdown."""


def generate(prompt, schema: type[BaseModel], temperature: float) -> BaseModel:
    """One structured-output call, retried once on the backup model."""
    config = types.GenerateContentConfig(
        system_instruction=CONNIE_PERSONA,
        response_mime_type="application/json",
        response_schema=schema,
        temperature=temperature,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    last_error = None
    for model in (MODEL, BACKUP_MODEL):
        try:
            resp = client().models.generate_content(model=model, contents=prompt, config=config)
            if resp.parsed is not None:
                return resp.parsed
            last_error = ValueError(f"{model} returned no parsable JSON")
        except Exception as e:
            last_error = e
    raise last_error


class DataAdvice(BaseModel):
    message: str = Field(description="1-2 sentences to the user, in Connie's voice.")
    tip: str = Field(description="One short, concrete next step (under 12 words).")
    mood: Literal["cheerful", "concerned", "alarmed"] = Field(
        description="cheerful if safe, concerned for contact/personal info, "
        "alarmed for government IDs, financial data, or credentials."
    )


def data_sharing_advice(verdict: dict, sensitivity: str, file_name: str | None) -> DataAdvice:
    found = ", ".join(verdict.get("matches") or []) or "nothing"
    prompt = f"""The user is about to upload a file to an AI chat tool.
File: {file_name or "unnamed file"}
Their data-sharing sensitivity slider: {sensitivity} (low = only flag obvious secrets,
high = flag anything remotely personal)
Detector verdict: {verdict["choice"]} (confidence {verdict.get("confidence")})
Category: {verdict.get("category")}
What was found: {found}

If the verdict is "safe", reassure them briefly.
If it is "flag", name what was found and why it matters once an AI tool has it
(it may be stored, reviewed, or used for training). Mention their slider setting
only when it explains why you flagged something minor, e.g. on high."""

    return generate(prompt, DataAdvice, temperature=0.6)


class ToolAdvice(BaseModel):
    pick: str = Field(description="Exactly one tool name from the list provided.")
    reason: str = Field(description="One sentence in Connie's voice on why it fits this task.")


TOOLS = {
    "ChatGPT": "general-purpose chat, brainstorming, everyday questions",
    "Claude": "careful long-form writing, editing, analysis of long documents",
    "Gemini": "very long context, PDFs, video, images, Google Workspace",
    "GitHub Copilot": "writing and debugging code inside the editor",
    "Midjourney": "generating images, logos, and illustrations",
    "Perplexity": "web search with cited sources, current events",
}


def recommend_tool(task: str, candidates: dict[str, str] = TOOLS) -> ToolAdvice:
    listing = "\n".join(f"- {name}: {use}" for name, use in candidates.items())
    prompt = f"""The user wants to do this task: "{task}"

Pick the single best tool from this list, and explain why in one friendly sentence:
{listing}"""
    advice = generate(prompt, ToolAdvice, temperature=0.3)
    if advice.pick not in candidates:
        raise ValueError(f"Gemini picked an unknown tool: {advice.pick}")
    return advice


class ToolReason(BaseModel):
    reason: str = Field(description="One sentence in Connie's voice on why this tool fits.")


def explain_tool(task: str, pick: str) -> str:
    """Jev already picked the tool; Gemini only explains the choice."""
    prompt = f"""The user wants to do this task: "{task}"
The best tool for it is {pick} ({TOOLS.get(pick, "")}).
Explain in one friendly sentence why {pick} fits this task."""
    return generate(prompt, ToolReason, temperature=0.5).reason


class ImageText(BaseModel):
    text: str = Field(description="All readable text in the image, transcribed verbatim.")
    description: str = Field(description="One sentence on what the image shows, e.g. 'a photo of a driver's license'.")


def read_image(data: bytes, mime: str) -> str:
    """Multimodal: transcribe an image so the detectors can check it like any file."""
    prompt = ("Transcribe all readable text in this image exactly as written, "
              "including numbers, names, and addresses. Then describe the image in one sentence.")
    result = generate([types.Part.from_bytes(data=data, mime_type=mime), prompt], ImageText, temperature=0)
    return f"Image shows: {result.description}\n\n{result.text}"
