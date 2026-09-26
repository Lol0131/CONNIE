-- Connie: demo seed data. Generated from backend/connie/seed.py; keep the two in sync.
USE SCHEMA CONNIE.APP;

INSERT INTO USER_CONNIE_SETTINGS (user_id, data_sharing_sensitivity, spending_strictness, tool_assertiveness)
VALUES ('demo', 'medium', 'medium', 'low');

INSERT INTO INTERACTIONS (created_at, type, summary, verdict) VALUES
  ('2026-09-10 09:14:00 +00:00', 'data_sharing', 'Flagged resume_final.pdf (home address, phone number) before upload to ChatGPT. User removed the file.', 'flag'),
  ('2026-09-11 16:40:00 +00:00', 'tool_selection', 'User asked ChatGPT to summarize a 180-page PDF. Suggested Gemini for long context.', 'recommendation'),
  ('2026-09-12 11:05:00 +00:00', 'data_sharing', 'Flagged tax_return_2025.pdf (Social Security number) before upload to Claude. User removed the file.', 'flag'),
  ('2026-09-13 20:22:00 +00:00', 'spending', 'Monthly AI spend reached $80, over the $60 budget. ChatGPT Plus, Claude Pro, and Gemini Advanced all used for writing.', 'flag'),
  ('2026-09-14 13:30:00 +00:00', 'data_sharing', 'Checked lecture_notes_week3.txt before upload to Gemini. Nothing personal found.', 'safe'),
  ('2026-09-15 10:12:00 +00:00', 'data_sharing', 'Flagged .env file (API key) before paste into ChatGPT. User removed the file.', 'flag'),
  ('2026-09-16 18:45:00 +00:00', 'tool_selection', 'User asked a chatbot to debug a Python stack trace. Suggested GitHub Copilot, already paid for.', 'recommendation'),
  ('2026-09-17 08:50:00 +00:00', 'data_sharing', 'Flagged medical_intake_form.docx (date of birth, medication list) before upload to ChatGPT. User shared anyway.', 'flag'),
  ('2026-09-18 15:03:00 +00:00', 'spending', 'Midjourney subscription used twice this month ($10). Suggested pausing it.', 'flag'),
  ('2026-09-19 12:27:00 +00:00', 'data_sharing', 'Flagged bank_statement_aug.csv (account number) before upload to Claude. User removed the file.', 'flag'),
  ('2026-09-21 19:10:00 +00:00', 'tool_selection', 'User asked for a logo in ChatGPT. Suggested Midjourney for image generation.', 'recommendation'),
  ('2026-09-23 14:02:00 +00:00', 'data_sharing', 'Checked group_project_outline.md before upload to Gemini. Nothing personal found.', 'safe'),
  ('2026-09-24 22:15:00 +00:00', 'data_sharing', 'Flagged lease_agreement.pdf (home address, full name) before upload to ChatGPT. User removed the file.', 'flag');
