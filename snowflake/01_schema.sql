-- Connie: Snowflake setup. Run in a Snowsight worksheet, top to bottom.
CREATE WAREHOUSE IF NOT EXISTS CONNIE_WH
  WAREHOUSE_SIZE = 'XSMALL' AUTO_SUSPEND = 60 AUTO_RESUME = TRUE;
CREATE DATABASE IF NOT EXISTS CONNIE;
CREATE SCHEMA IF NOT EXISTS CONNIE.APP;
USE SCHEMA CONNIE.APP;
USE WAREHOUSE CONNIE_WH;

-- Slider settings (one row per user). Values: 'low' | 'medium' | 'high'.
CREATE OR REPLACE TABLE USER_CONNIE_SETTINGS (
    user_id                   STRING PRIMARY KEY,
    data_sharing_sensitivity  STRING DEFAULT 'medium',
    spending_strictness       STRING DEFAULT 'medium',
    tool_assertiveness        STRING DEFAULT 'low',
    updated_at                TIMESTAMP_TZ DEFAULT CURRENT_TIMESTAMP()
);

-- Every Connie interaction. This is what Cortex Search indexes for "ask your history".
-- Maps to POST /log { time, type, summary, verdict }.
CREATE OR REPLACE TABLE INTERACTIONS (
    id          STRING DEFAULT UUID_STRING(),
    user_id     STRING DEFAULT 'demo',
    created_at  TIMESTAMP_TZ,
    type        STRING,   -- 'data_sharing' | 'spending' | 'tool_selection'
    summary     STRING,   -- plain-English sentence; the searchable text
    verdict     STRING    -- 'flag' | 'safe' | 'recommendation' | 'action'
);

-- Cortex Search needs change tracking on its source table.
ALTER TABLE INTERACTIONS SET CHANGE_TRACKING = TRUE;
