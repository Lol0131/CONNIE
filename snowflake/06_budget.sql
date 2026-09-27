-- Connie: store the user's monthly AI budget with their settings.
-- Only needed if you ran 01_schema.sql before the budget existed (new setups
-- already have the column). Safe to re-run.
USE ROLE ACCOUNTADMIN;
USE SCHEMA CONNIE.APP;

ALTER TABLE USER_CONNIE_SETTINGS ADD COLUMN IF NOT EXISTS monthly_budget NUMBER(10, 2) DEFAULT 60;
UPDATE USER_CONNIE_SETTINGS SET monthly_budget = 60 WHERE monthly_budget IS NULL;

SELECT user_id, monthly_budget FROM USER_CONNIE_SETTINGS;  -- should show demo | 60
