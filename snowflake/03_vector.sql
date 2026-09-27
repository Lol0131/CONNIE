-- Connie: semantic search over history with Snowflake VECTOR columns.
-- Works on trial accounts: vector types and VECTOR_COSINE_SIMILARITY are plain
-- SQL, not Cortex AI functions. The backend embeds text with Gemini and stores
-- the vectors here; Snowflake does the similarity search.
-- (Have AI features enabled? You can also run 05_cortex_optional.sql.)
USE ROLE ACCOUNTADMIN;
USE SCHEMA CONNIE.APP;
USE WAREHOUSE CONNIE_WH;

ALTER TABLE INTERACTIONS ADD COLUMN IF NOT EXISTS embedding VECTOR(FLOAT, 768);

-- Smoke tests: both should return a value, not an error.
SELECT VECTOR_COSINE_SIMILARITY([1, 2, 3]::VECTOR(FLOAT, 3), [1, 2, 4]::VECTOR(FLOAT, 3)) AS similarity;  -- ~0.99
SELECT PARSE_JSON('[0.1, 0.2, 0.3]')::ARRAY::VECTOR(FLOAT, 3) AS parsed_vector;  -- how the backend sends vectors

-- The seed rows start without embeddings; the backend fills them in on first use.
SELECT COUNT(*) AS rows_total, COUNT(embedding) AS rows_embedded FROM INTERACTIONS;
