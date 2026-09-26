"""Jev (TypeSafe AI System One): fast, typed decisions. Never writes text.

Docs: https://docs.typesafe.ai/api
  POST https://api.typesafe.ai/v1/systemone
  { state, model, questions: { name: { type: noul|choice|score, instructions, criteria } } }
  -> { answers: { name: { type, noul | choice+confidence+probabilities } } }

Jev answers *what is in the file* (one yes/no per category). The user's slider
decides *what counts*: which categories get flagged and how sure Jev must be.
"""
import os

import requests

URL = "https://api.typesafe.ai/v1/systemone"
MODEL = os.getenv("JEV_MODEL", "jev-latest")
TIMEOUT_S = 5


def enabled() -> bool:
    return bool(os.getenv("TYPESAFE_API_KEY"))


def ask(state: str, questions: dict) -> dict:
    resp = requests.post(
        URL,
        headers={"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"},
        json={"state": state, "model": MODEL, "questions": questions},
        timeout=TIMEOUT_S,
    )
    resp.raise_for_status()
    return resp.json()["answers"]


# --- Pillar 1: data sharing ------------------------------------------------------

CATEGORY_QUESTIONS = {
    "government_id": "Does this contain a government ID number, such as a Social Security, "
                     "passport, or driver's license number?",
    "financial": "Does this contain financial account details, such as a credit card, "
                 "bank account, or routing number?",
    "credentials": "Does this contain a password, API key, access token, or other secret?",
    "contact_info": "Does this contain personal contact details, such as a home address, "
                    "personal phone number, personal email, or date of birth?",
    "personal_details": "Does this identify a specific private person, such as their full "
                        "name, school, employer, or health information?",
}
LABELS = {
    "government_id": "government ID number",
    "financial": "financial account details",
    "credentials": "password or API key",
    "contact_info": "personal contact details",
    "personal_details": "identifying personal details",
}

# Which categories each slider level flags, and how sure Jev must be.
COUNTED = {
    "low": ["government_id", "financial", "credentials"],
    "medium": ["government_id", "financial", "credentials", "contact_info"],
    "high": list(CATEGORY_QUESTIONS),
}
THRESHOLD = {"low": 0.8, "medium": 0.6, "high": 0.4}
SEVERITY = ["government_id", "financial", "credentials", "contact_info", "personal_details"]


def check(text: str, sensitivity: str, file_name: str | None) -> dict:
    """Same shape as rules.check(): choice, category, confidence, matches."""
    state = f"File name: {file_name or 'unknown'}\n\nFile contents:\n{text}"
    questions = {
        name: {
            "type": "noul",
            "instructions": q,
            "criteria": {
                "true": "The text itself contains this kind of real data about a person.",
                "false": "It doesn't, or only mentions the topic without real values "
                         "(e.g. a blank form field or a placeholder).",
            },
        }
        for name, q in CATEGORY_QUESTIONS.items()
    }
    answers = ask(state, questions)
    probs = {name: answers[name]["noul"] for name in CATEGORY_QUESTIONS}

    hits = [c for c in COUNTED[sensitivity] if probs[c] >= THRESHOLD[sensitivity]]
    if not hits:
        top = max(probs[c] for c in COUNTED[sensitivity])
        return {"choice": "safe", "category": "none", "confidence": round(1 - top, 2),
                "matches": [], "probabilities": probs}

    category = min(hits, key=SEVERITY.index)
    return {
        "choice": "flag",
        "category": category,
        "confidence": round(max(probs[c] for c in hits), 2),
        "matches": [LABELS[c] for c in sorted(hits, key=SEVERITY.index)],
        "probabilities": probs,
    }


# --- Pillar 3: tool selection ---------------------------------------------------

def pick_tool(task: str, tools: dict[str, str]) -> tuple[str, float]:
    answers = ask(
        f"The user wants to do this task: {task}",
        {"tool": {
            "type": "choice",
            "instructions": "Which AI tool is the best fit for this task?",
            "criteria": tools,
        }},
    )
    tool = answers["tool"]
    return tool["choice"], tool.get("confidence", 0.0)
