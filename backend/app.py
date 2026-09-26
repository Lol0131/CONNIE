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
from flask import Flask, jsonify, redirect, request, send_from_directory
from flask_cors import CORS

from connie import gemini, rules
from connie.seed import SEED_HISTORY

load_dotenv()

ROOT = Path(__file__).resolve().parent.parent
LEVELS = {"low", "medium", "high"}
STOPWORDS = set("a an and the i my me did do does when what how much many is am are was to of in on for with ai have has".split())

app = Flask(__name__)
CORS(app)

# TODO(snowflake): read/write CONNIE.APP.USER_CONNIE_SETTINGS instead.
settings = {"dataSharing": "medium", "spending": "medium", "toolAssertiveness": "low"}
# TODO(snowflake): INSERT into CONNIE.APP.INTERACTIONS instead.
history = list(SEED_HISTORY)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@app.post("/check-content")
def check_content():
    body = request.get_json(force=True) or {}
    text = body.get("text", "")
    sensitivity = body.get("sensitivity") or settings["dataSharing"]
    if sensitivity not in LEVELS:
        return jsonify(error="sensitivity must be low, medium, or high"), 400

    # TODO(jev): POST https://api.typesafe.ai/v1/systemone with the text as `state`
    # and typed questions (flag? noul / category? choice). Fall back to rules on error.
    verdict = rules.check(text, sensitivity)
    verdict_engine = "rules"

    file_name = body.get("fileName")
    try:
        advice = gemini.data_sharing_advice(verdict, sensitivity, file_name).model_dump()
        voice = "gemini"
    except Exception as e:
        app.logger.warning("Gemini failed, using template: %s", e)
        advice = rules.fallback_advice(verdict, sensitivity, file_name)
        voice = "template"

    return jsonify(**verdict, **advice, engine={"verdict": verdict_engine, "voice": voice})


@app.post("/log")
def log():
    body = request.get_json(force=True) or {}
    entry = {
        "time": body.get("time") or now_iso(),
        "type": body.get("type", "data_sharing"),
        "summary": body.get("summary", ""),
        "verdict": body.get("verdict", ""),
    }
    history.append(entry)
    return jsonify(ok=True)


@app.get("/search")
def search():
    q = request.args.get("q", "").strip().lower()
    # TODO(snowflake): query the CONNIE_HISTORY_SEARCH Cortex Search service
    # (REST: POST /api/v2/databases/CONNIE/schemas/APP/cortex-search-services/CONNIE_HISTORY_SEARCH:query).
    # Stub: rank by how many meaningful query words appear in the entry.
    words = [w for w in re.findall(r"[a-z0-9$]+", q) if w not in STOPWORDS]
    if not words:
        return jsonify(sorted(history, key=lambda h: h["time"], reverse=True)[:20])
    scored = []
    for h in history:
        text = f"{h['summary']} {h['type']} {h['verdict']}".lower()
        score = sum(w in text for w in words)
        if score:
            scored.append((score, h["time"], h))
    scored.sort(key=lambda s: (s[0], s[1]), reverse=True)
    return jsonify([h for _, _, h in scored[:20]])


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
            advice = gemini.recommend_tool(task)
            return jsonify(pick=advice.pick, reason=advice.reason)
        except Exception as e:
            app.logger.warning("Gemini tool pick failed, using keywords: %s", e)
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
