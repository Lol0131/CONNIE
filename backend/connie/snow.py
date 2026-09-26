"""Snowflake over REST: the SQL API for storage, Cortex for "ask your history".

- SQL API        POST /api/v2/statements            settings + interaction log
- Cortex Search  POST /api/v2/databases/.../cortex-search-services/...:query   retrieval
- Cortex LLM     SNOWFLAKE.CORTEX.COMPLETE (via the SQL API)                   the answer

Auth is a programmatic access token (PAT). Run snowflake/01-03 first.
"""
import os

import requests

TIMEOUT_S = 20
USER_ID = os.getenv("CONNIE_USER_ID", "demo")
SEARCH_SERVICE = "CONNIE_HISTORY_SEARCH"
LLM = os.getenv("SNOWFLAKE_LLM", "mistral-large2")
SEARCH_COLUMNS = ["summary", "type", "verdict", "logged_at"]


def enabled() -> bool:
    return bool(os.getenv("SNOWFLAKE_ACCOUNT") and os.getenv("SNOWFLAKE_PAT"))


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
    sql("INSERT INTO INTERACTIONS (user_id, created_at, type, summary, verdict) "
        "SELECT ?, TO_TIMESTAMP_TZ(?), ?, ?, ?",
        USER_ID, entry["time"], entry["type"], entry["summary"], entry["verdict"])


def recent(limit: int = 20) -> list[dict]:
    rows = sql(
        "SELECT summary, type, verdict, "
        "TO_VARCHAR(CONVERT_TIMEZONE('UTC', created_at), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS logged_at "
        f"FROM INTERACTIONS WHERE user_id = ? ORDER BY created_at DESC LIMIT {int(limit)}", USER_ID)
    return [{"time": r.pop("logged_at"), **r} for r in rows]


def search(query: str, limit: int = 8) -> list[dict]:
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
    """Cortex COMPLETE writes Connie's answer from the retrieved entries (the generation half)."""
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
