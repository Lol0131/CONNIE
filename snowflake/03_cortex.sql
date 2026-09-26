-- Connie: "ask your history" via Cortex Search (RAG) + Cortex LLM.
USE SCHEMA CONNIE.APP;
USE WAREHOUSE CONNIE_WH;

-- 1. Search service over the interaction summaries.
CREATE OR REPLACE CORTEX SEARCH SERVICE CONNIE_HISTORY_SEARCH
  ON summary
  ATTRIBUTES user_id, type, verdict
  WAREHOUSE = CONNIE_WH
  TARGET_LAG = '1 minute'
  AS (
    SELECT summary, user_id, type, verdict, created_at
    FROM INTERACTIONS
  );

-- 2. Smoke test from SQL. If this returns results, the backend's REST call will too.
SELECT PARSE_JSON(
  SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
    'CONNIE.APP.CONNIE_HISTORY_SEARCH',
    '{
       "query": "when did I share my home address?",
       "columns": ["summary", "type", "verdict", "created_at"],
       "filter": {"@eq": {"user_id": "demo"}},
       "limit": 5
     }'
  )
)['results'] AS results;

-- 3. The same query over REST (what backend/app.py /search calls):
--   POST https://<account>.snowflakecomputing.com/api/v2/databases/CONNIE/schemas/APP/cortex-search-services/CONNIE_HISTORY_SEARCH:query
--   Authorization: Bearer <PAT or JWT>
--   { "query": "...", "columns": ["summary","type","verdict","created_at"],
--     "filter": {"@eq": {"user_id": "demo"}}, "limit": 5 }

-- 4. Optional: have a Cortex LLM answer in one sentence using the search results (the "G" in RAG).
--    Model availability depends on your account region. Swap the model name if this one errors.
WITH hits AS (
  SELECT PARSE_JSON(
    SNOWFLAKE.CORTEX.SEARCH_PREVIEW(
      'CONNIE.APP.CONNIE_HISTORY_SEARCH',
      '{"query": "how much am I spending on AI?", "columns": ["summary","created_at"], "limit": 5}'
    )
  )['results'] AS r
)
SELECT SNOWFLAKE.CORTEX.COMPLETE(
  'mistral-large2',
  'You are Connie, a friendly AI-usage helper. Answer the question in one or two warm sentences '
  || 'using only these history entries: ' || r::STRING
  || ' Question: how much am I spending on AI?'
) AS connie_answer
FROM hits;
