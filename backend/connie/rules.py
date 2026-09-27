"""Rule-based fallback detector.

Stands in for Jev until the real call is wired up, and stays as the fallback if
Jev is slow or down. Returns the same shape Jev's verdict gets mapped into, so
Gemini and Snowflake don't care which one produced it.
"""
import re

# (label, category, regex, minimum sensitivity that flags it)
RULES = [
    ("Social Security number", "government_id", r"\b\d{3}-\d{2}-\d{4}\b", "low"),
    ("driver's license or passport number", "government_id",
     r"(?i)\b(dl|driver'?s? licen[cs]e|licen[cs]e|passport)\s*(no\.?|number|#)\s*[:#]?\s*[A-Z0-9][A-Z0-9-]{5,}", "low"),
    ("credit card number", "financial", r"\b(?:\d{4}[ -]?){3}\d{4}\b", "low"),
    ("password or API key", "credentials",
     r"(?i)(password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9-]{12,}", "low"),
    ("bank account / routing number", "financial", r"(?i)\b(routing|account)\s*(number|no\.?|#)\s*[:#]?\s*\d{6,}", "low"),
    ("email address", "contact_info", r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b", "medium"),
    ("phone number", "contact_info", r"(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b", "medium"),
    ("street address", "contact_info",
     r"(?i)\b\d{1,5}\s+(?:[NSEW]\.?\s+)?\w+(?:\s\w+)?\s+(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|ct|court|way|terrace|ter|pl|place)\b", "medium"),
    ("date of birth", "personal_details", r"(?i)\b(dob|date of birth|born)\b", "medium"),
    ("ZIP code", "contact_info", r"\b\d{5}(?:-\d{4})?\b", "high"),
    ("full name", "personal_details", r"(?m)^\s*(?:name\s*[:\-]\s*)?[A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][a-z]+\s*$", "high"),
    ("employer or school", "personal_details", r"(?i)\b(university|college|inc\.|llc|corp)\b", "high"),
    ("health information", "personal_details", r"(?i)\b(diagnos\w*|prescription|medication|therapy)\b", "high"),
]

LEVELS = {"low": 0, "medium": 1, "high": 2}
# Most serious category wins when several match.
CATEGORY_ORDER = ["government_id", "financial", "credentials", "contact_info", "personal_details"]


def labeled_hits(text: str, sensitivity: str) -> list[tuple[str, str]]:
    """(label, category) for every rule that matches at this sensitivity."""
    level = LEVELS.get(sensitivity, 1)
    return [
        (label, category)
        for label, category, pattern, min_level in RULES
        if LEVELS[min_level] <= level and re.search(pattern, text or "")
    ]


def check(text: str, sensitivity: str) -> dict:
    hits = labeled_hits(text, sensitivity)
    if not hits:
        return {"choice": "safe", "category": "none", "confidence": 0.8, "matches": []}

    category = min((c for _, c in hits), key=CATEGORY_ORDER.index)
    # Crude confidence: serious categories and more hits make it surer.
    confidence = min(0.99, 0.7 + 0.08 * len(hits) + (0.15 if category in CATEGORY_ORDER[:3] else 0))
    return {
        "choice": "flag",
        "category": category,
        "confidence": round(confidence, 2),
        "matches": [label for label, _ in hits],
    }


def fallback_advice(verdict: dict, sensitivity: str, file_name: str | None) -> dict:
    """Same shape as gemini.DataAdvice, for when Gemini is unreachable."""
    if verdict["choice"] == "safe":
        return {"message": connie_message(verdict, sensitivity, file_name),
                "tip": "You're good to share this one.", "mood": "cheerful"}
    serious = verdict["category"] in ("government_id", "financial", "credentials")
    return {
        "message": connie_message(verdict, sensitivity, file_name),
        "tip": "Remove those details before uploading, or share a redacted copy.",
        "mood": "alarmed" if serious else "concerned",
    }


def connie_message(verdict: dict, sensitivity: str, file_name: str | None) -> str:
    """Template message in Connie's voice, used when Gemini is unavailable."""
    what = f"“{file_name}”" if file_name else "this file"
    if verdict["choice"] == "safe":
        return f"I looked through {what} and didn't spot anything personal. You're good to go!"
    found = verdict["matches"]
    listed = found[0] if len(found) == 1 else ", ".join(found[:-1]) + f" and {found[-1]}"
    note = {
        "low": "Even on low sensitivity, this one's worth a second look.",
        "medium": "",
        "high": "You have sensitivity set to high, so I'm being extra careful.",
    }[sensitivity]
    return f"Heads up! {what} includes your {listed}. AI tools may keep what you upload. {note}".strip()
