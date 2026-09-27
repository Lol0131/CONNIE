"""Snowflake over REST: settings, the interaction log, and "ask your history".

Everything goes through the SQL API (POST /api/v2/statements) with a
programmatic access token (PAT). History search has two modes, picked by
SNOWFLAKE_SEARCH in .env:

- vector (default): Gemini embeds each entry; Snowflake stores it in a
  VECTOR(FLOAT, 768) column and ranks with VECTOR_COSINE_SIMILARITY; Gemini
  writes the answer. Works on trial accounts (snowflake/03_vector.sql).
- cortex: Cortex Search REST retrieves, Cortex COMPLETE answers. Needs
  Snowflake AI features (snowflake/05_cortex_optional.sql).
"""
import json
import os

import requests

from connie import gemini

TIMEOUT_S = 20
USER_ID = os.getenv("CONNIE_USER_ID", "demo")
SEARCH_SERVICE = "CONNIE_HISTORY_SEARCH"
LLM = os.getenv("SNOWFLAKE_LLM", "mistral-large2")
SEARCH_COLUMNS = ["summary", "type", "verdict", "logged_at"]


def enabled() -> bool:
    return bool(os.getenv("SNOWFLAKE_ACCOUNT") and os.getenv("SNOWFLAKE_PAT"))


def mode() -> str:
    return "cortex" if os.getenv("SNOWFLAKE_SEARCH", "vector").lower() == "cortex" else "vector"


VECTOR = f"PARSE_JSON(?)::ARRAY::VECTOR(FLOAT, {gemini.EMBED_DIM})"


def _base() -> str:
    return f"https://{os.environ['SNOWFLAKE_ACCOUNT']}.snowflakecomputing.com"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {os.environ['SNOWFLAKE_PAT']}",
        "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _db() -> str:
    return os.getenv("SNOWFLAKE_DATABASE", "CONNIE")


def _schema() -> str:
    return os.getenv("SNOWFLAKE_SCHEMA", "APP")


def sql(statement: str, *params: str) -> list[dict]:
    """Run one statement through the SQL API. `?` placeholders bind to params."""
    body = {
        "statement": statement,
        "timeout": TIMEOUT_S,
        "database": _db(),
        "schema": _schema(),
        "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE", "CONNIE_WH"),
        "bindings": {str(i): {"type": "TEXT", "value": p} for i, p in enumerate(params, 1)},
    }
    if os.getenv("SNOWFLAKE_ROLE"):
        body["role"] = os.environ["SNOWFLAKE_ROLE"]
    resp = requests.post(f"{_base()}/api/v2/statements", headers=_headers(), json=body, timeout=TIMEOUT_S + 5)
    resp.raise_for_status()
    data = resp.json()
    cols = [c["name"].lower() for c in data.get("resultSetMetaData", {}).get("rowType", [])]
    return [dict(zip(cols, row)) for row in data.get("data", [])]


# --- Settings ------------------------------------------------------------------

def load_settings() -> dict | None:
    rows = sql(
        "SELECT data_sharing_sensitivity, spending_strictness, tool_assertiveness "
        "FROM USER_CONNIE_SETTINGS WHERE user_id = ?", USER_ID)
    if not rows:
        return None
    r = rows[0]
    return {"dataSharing": r["data_sharing_sensitivity"], "spending": r["spending_strictness"],
            "toolAssertiveness": r["tool_assertiveness"]}


def save_settings(s: dict) -> None:
    sql("""MERGE INTO USER_CONNIE_SETTINGS t
           USING (SELECT ? AS user_id, ? AS ds, ? AS sp, ? AS ta) s ON t.user_id = s.user_id
           WHEN MATCHED THEN UPDATE SET data_sharing_sensitivity = s.ds, spending_strictness = s.sp,
                tool_assertiveness = s.ta, updated_at = CURRENT_TIMESTAMP()
           WHEN NOT MATCHED THEN INSERT (user_id, data_sharing_sensitivity, spending_strictness, tool_assertiveness)
                VALUES (s.user_id, s.ds, s.sp, s.ta)""",
        USER_ID, s["dataSharing"], s["spending"], s["toolAssertiveness"])


# --- Interactions -----------------------------------------------------------------

def log(entry: dict) -> None:
    params = [USER_ID, entry["time"], entry["type"], entry["summary"], entry["verdict"]]
    vec = None
    if mode() == "vector":
        try:
            vec = json.dumps(gemini.embed([entry["summary"]])[0])
        except Exception:
            pass  # store the row anyway; backfill_embeddings() adds the vector later
    if vec:
        sql("INSERT INTO INTERACTIONS (user_id, created_at, type, summary, verdict, embedding) "
            f"SELECT ?, TO_TIMESTAMP_TZ(?), ?, ?, ?, {VECTOR}", *params, vec)
    else:
        sql("INSERT INTO INTERACTIONS (user_id, created_at, type, summary, verdict) "
            "SELECT ?, TO_TIMESTAMP_TZ(?), ?, ?, ?", *params)


_backfilled = False


def backfill_embeddings() -> int:
    """Embed any rows stored without a vector (the seed rows, or a failed embed)."""
    global _backfilled
    rows = sql("SELECT id, summary FROM INTERACTIONS WHERE user_id = ? AND embedding IS NULL LIMIT 100", USER_ID)
    if rows:
        vectors = gemini.embed([r["summary"] for r in rows])
        for r, v in zip(rows, vectors):
            sql(f"UPDATE INTERACTIONS SET embedding = {VECTOR} WHERE id = ?", json.dumps(v), r["id"])
    _backfilled = True
    return len(rows)


def recent(limit: int = 20) -> list[dict]:
    rows = sql(
        "SELECT summary, type, verdict, "
        "TO_VARCHAR(CONVERT_TIMEZONE('UTC', created_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS logged_at "
        f"FROM INTERACTIONS WHERE user_id = ? ORDER BY created_at DESC LIMIT {int(limit)}", USER_ID)
    return [{"time": r.pop("logged_at"), **r} for r in rows]


def search(query: str, limit: int = 8) -> list[dict]:
    return cortex_search(query, limit) if mode() == "cortex" else vector_search(query, limit)


def vector_search(query: str, limit: int = 8) -> list[dict]:
    """Semantic search inside Snowflake: cosine similarity over stored Gemini embeddings."""
    if not _backfilled:
        backfill_embeddings()
    qvec = json.dumps(gemini.embed([query], task="RETRIEVAL_QUERY")[0])
    rows = sql(
        "SELECT summary, type, verdict, "
        "TO_VARCHAR(CONVERT_TIMEZONE('UTC', created_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS logged_at, "
        f"VECTOR_COSINE_SIMILARITY(embedding, {VECTOR}) AS score "
        "FROM INTERACTIONS WHERE user_id = ? AND embedding IS NOT NULL "
        f"ORDER BY score DESC LIMIT {int(limit)}", qvec, USER_ID)
    return [{"time": r["logged_at"], "type": r["type"], "verdict": r["verdict"], "summary": r["summary"],
             "score": round(float(r["score"]), 3)} for r in rows]


def cortex_search(query: str, limit: int = 8) -> list[dict]:
    """Cortex Search over interaction summaries (the retrieval half of RAG)."""
    url = (f"{_base()}/api/v2/databases/{_db()}/schemas/{_schema()}"
           f"/cortex-search-services/{SEARCH_SERVICE}:query")
    resp = requests.post(url, headers=_headers(), timeout=TIMEOUT_S, json={
        "query": query,
        "columns": SEARCH_COLUMNS,
        "filter": {"@eq": {"user_id": USER_ID}},
        "limit": limit,
    })
    resp.raise_for_status()
    return [{"time": r.get("logged_at"), "type": r.get("type"), "verdict": r.get("verdict"),
             "summary": r.get("summary")} for r in resp.json().get("results", [])]


def answer(question: str, sources: list[dict]) -> str:
    """Connie's answer from the retrieved entries: Cortex COMPLETE, or Gemini in vector mode."""
    if mode() == "vector":
        return gemini.answer_history(question, sources)
    context = "\n".join(f"- [{s['time']}] ({s['type']}, {s['verdict']}) {s['summary']}" for s in sources)
    prompt = (
        "You are Connie, a warm, friendly helper for using AI tools mindfully. "
        "Answer the user's question about their own AI usage in 1-3 short sentences, "
        "using ONLY the history entries below. Mention dates when helpful. "
        "If the entries don't answer it, say so kindly.\n\n"
        f"History:\n{context or '(no matching entries)'}\n\nQuestion: {question}"
    )
    rows = sql("SELECT SNOWFLAKE.CORTEX.COMPLETE(?, ?) AS answer", LLM, prompt)
    return rows[0]["answer"].strip()
