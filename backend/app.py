"""Connie backend: the shared brain.

Every endpoint here returns the shapes in API_CONTRACT.md. Right now the logic is
stubbed (regex detector, in-memory history). Each TODO marks where the real Jev,
Gemini, or Snowflake call goes; swap it in without changing the response shape.

Run:  python app.py   ->  http://localhost:5050
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

# Before importing connie modules, which read settings at import time. override=True
# so edits to .env win over stale values (e.g. an empty key the reloader inherited).
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from flask import Flask, jsonify, redirect, request, send_from_directory  # noqa: E402
from flask_cors import CORS  # noqa: E402

from connie import extract, gemini, jev, rules, snow  # noqa: E402
from connie.seed import SEED_HISTORY  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEVELS = {"low", "medium", "high"}
STOPWORDS = set("a an and the i my me did do does when what how much many is am are was to of in on for with ai have has".split())

app = Flask(__name__)
CORS(app)

# Settings are cached here and written through to Snowflake when it's configured.
settings = {"dataSharing": "medium", "spending": "medium", "toolAssertiveness": "low"}
# Used only when Snowflake isn't configured (or is unreachable).
history = list(SEED_HISTORY)

if snow.enabled():
    try:
        settings.update(snow.load_settings() or {})
    except Exception as e:
        app.logger.warning("Couldn't load settings from Snowflake: %s", e)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def detect(text: str, sensitivity: str, file_name: str | None) -> tuple[dict, str]:
    """Jev decides; the regex rules name specifics (and take over if Jev is down)."""
    found = rules.check(text, sensitivity)
    if not jev.enabled():
        return found, "rules"
    try:
        verdict = jev.check(text, sensitivity, file_name)
    except Exception as e:
        app.logger.warning("Jev failed, using rules: %s", e)
        return found, "rules"
    if verdict["choice"] == "flag":
        # Prefer the rules' precise labels ("Social Security number") within the
        # categories Jev flagged; keep Jev's generic label where rules found nothing.
        hit_cats = {c for c, label in jev.LABELS.items() if label in verdict["matches"]}
        precise = [(label, cat) for label, cat in rules.labeled_hits(text, "high") if cat in hit_cats]
        covered = {cat for _, cat in precise}
        verdict["matches"] = [label for label, _ in precise] + [
            jev.LABELS[c] for c in jev.SEVERITY if c in hit_cats - covered
        ]
    return verdict, "jev"


@app.post("/check-content")
def check_content():
    body = request.get_json(force=True) or {}
    text = body.get("text", "")
    sensitivity = body.get("sensitivity") or settings["dataSharing"]
    if sensitivity not in LEVELS:
        return jsonify(error="sensitivity must be low, medium, or high"), 400

    file_name = body.get("fileName")
    extracted_by = "client"
    if body.get("fileBase64"):
        try:
            text, extracted_by = extract.extract(body["fileBase64"], file_name, body.get("mimeType", ""))
        except Exception as e:
            app.logger.warning("Couldn't extract %s: %s", file_name, e)
            text, extracted_by = f"Filename: {file_name}", "filename-only"
    verdict, verdict_engine = detect(text, sensitivity, file_name)

    # Connie holds the file while this runs, so safe files skip the Gemini round
    # trip. Gemini's words are for when there's something to explain.
    advice, voice = rules.fallback_advice(verdict, sensitivity, file_name), "template"
    if verdict["choice"] == "flag":
        try:
            advice = gemini.data_sharing_advice(verdict, sensitivity, file_name).model_dump()
            voice = "gemini"
        except Exception as e:
            app.logger.warning("Gemini failed, using template: %s", e)

    return jsonify(**verdict, **advice,
                   engine={"verdict": verdict_engine, "voice": voice, "extract": extracted_by})


@app.post("/log")
def log():
    body = request.get_json(force=True) or {}
    entry = {
        "time": body.get("time") or now_iso(),
        "type": body.get("type", "data_sharing"),
        "summary": body.get("summary", ""),
        "verdict": body.get("verdict", ""),
    }
    if snow.enabled():
        try:
            snow.log(entry)
            return jsonify(ok=True, stored="snowflake")
        except Exception as e:
            app.logger.warning("Snowflake log failed, keeping it in memory: %s", e)
    history.append(entry)
    return jsonify(ok=True, stored="memory")


def local_search(q: str, limit: int = 20) -> list[dict]:
    """Keyword ranking over the in-memory history, for when Snowflake is off."""
    words = [w for w in re.findall(r"[a-z0-9$]+", q.lower()) if w not in STOPWORDS]
    if not words:
        return sorted(history, key=lambda h: h["time"], reverse=True)[:limit]
    scored = []
    for h in history:
        text = f"{h['summary']} {h['type']} {h['verdict']}".lower()
        score = sum(w in text for w in words)
        if score:
            scored.append((score, h["time"], h))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return [h for _, _, h in scored[:limit]]


@app.get("/search")
def search():
    q = request.args.get("q", "").strip()
    if snow.enabled():
        try:
            return jsonify(snow.search(q) if q else snow.recent())
        except Exception as e:
            app.logger.warning("Snowflake search failed, using local history: %s", e)
    return jsonify(local_search(q))


@app.get("/ask")
def ask():
    """Ask your history: Cortex Search retrieves, Cortex COMPLETE answers."""
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify(error="q is required"), 400
    if snow.enabled():
        try:
            sources = snow.search(q, limit=6)
            return jsonify(answer=snow.answer(q, sources), sources=sources, engine="cortex")
        except Exception as e:
            app.logger.warning("Cortex ask failed, using local history: %s", e)
    sources = local_search(q, limit=6)
    n = len(sources)
    answer = (f"I found {n} entr{'y' if n == 1 else 'ies'} in your history that match. "
              "Here they are!" if n else "I couldn't find anything about that in your history.")
    return jsonify(answer=answer, sources=sources, engine="local")


@app.get("/settings")
def get_settings():
    return jsonify(settings)


@app.post("/settings")
def post_settings():
    body = request.get_json(force=True) or {}
    updates = {k: v for k, v in body.items() if k in settings}
    bad = [k for k, v in updates.items() if v not in LEVELS]
    if bad:
        return jsonify(error=f"invalid level for: {', '.join(bad)}"), 400
    settings.update(updates)
    if snow.enabled():
        try:
            snow.save_settings(settings)
        except Exception as e:
            app.logger.warning("Couldn't save settings to Snowflake: %s", e)
    return jsonify(ok=True)


TOOL_RULES = [
    (("pdf", "long", "book", "pages", "transcript", "video", "image of", "screenshot"),
     "Gemini", "Long context and multimodal input, so it can take the whole thing in one go."),
    (("code", "debug", "bug", "function", "python", "javascript", "stack trace", "error"),
     "GitHub Copilot", "It works inside your editor and already sees your code."),
    (("logo", "image", "picture", "art", "illustration", "poster"),
     "Midjourney", "It's built for image generation. Chat tools do this less well."),
    (("essay", "email", "write", "rewrite", "edit", "cover letter"),
     "Claude", "Strong at careful long-form writing and editing."),
]


@app.post("/recommend-tool")
def recommend_tool():
    task = ((request.get_json(force=True) or {}).get("task") or "").strip()
    if task:
        try:
            if jev.enabled():
                # Jev decides, Gemini explains.
                pick, _ = jev.pick_tool(task, gemini.TOOLS)
                return jsonify(pick=pick, reason=gemini.explain_tool(task, pick))
            advice = gemini.recommend_tool(task)
            return jsonify(pick=advice.pick, reason=advice.reason)
        except Exception as e:
            app.logger.warning("Tool pick failed, using keywords: %s", e)
    task = task.lower()
    for keywords, pick, reason in TOOL_RULES:
        if any(k in task for k in keywords):
            return jsonify(pick=pick, reason=reason)
    return jsonify(pick="ChatGPT", reason="A solid general-purpose pick for everyday questions.")


# --- Static pages, so the whole demo runs from one server -------------------
@app.get("/")
def index():
    return redirect("/app/")


@app.get("/app/")
@app.get("/app/<path:path>")
def webapp(path="index.html"):
    return send_from_directory(ROOT / "webapp", path)


@app.get("/demo/")
@app.get("/demo/<path:path>")
def demo(path="index.html"):
    return send_from_directory(ROOT / "extension" / "demo", path)


@app.get("/extension/<path:path>")
def extension_files(path):
    return send_from_directory(ROOT / "extension", path)


if __name__ == "__main__":
    app.run(port=int(os.getenv("PORT", 5050)), debug=True)
