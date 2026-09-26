"""In-memory stand-in for the Snowflake INTERACTIONS table.

Mirrors snowflake/02_seed.sql so /search returns the same things before and
after Snowflake is wired in.
"""
SEED_HISTORY = [
    {"time": "2026-09-10T09:14:00Z", "type": "data_sharing", "verdict": "flag",
     "summary": "Flagged resume_final.pdf (home address, phone number) before upload to ChatGPT. User removed the file."},
    {"time": "2026-09-11T16:40:00Z", "type": "tool_selection", "verdict": "recommendation",
     "summary": "User asked ChatGPT to summarize a 180-page PDF. Suggested Gemini for long context."},
    {"time": "2026-09-12T11:05:00Z", "type": "data_sharing", "verdict": "flag",
     "summary": "Flagged tax_return_2025.pdf (Social Security number) before upload to Claude. User removed the file."},
    {"time": "2026-09-13T20:22:00Z", "type": "spending", "verdict": "flag",
     "summary": "Monthly AI spend reached $80, over the $60 budget. ChatGPT Plus, Claude Pro, and Gemini Advanced all used for writing."},
    {"time": "2026-09-14T13:30:00Z", "type": "data_sharing", "verdict": "safe",
     "summary": "Checked lecture_notes_week3.txt before upload to Gemini. Nothing personal found."},
    {"time": "2026-09-15T10:12:00Z", "type": "data_sharing", "verdict": "flag",
     "summary": "Flagged .env file (API key) before paste into ChatGPT. User removed the file."},
    {"time": "2026-09-16T18:45:00Z", "type": "tool_selection", "verdict": "recommendation",
     "summary": "User asked a chatbot to debug a Python stack trace. Suggested GitHub Copilot, already paid for."},
    {"time": "2026-09-17T08:50:00Z", "type": "data_sharing", "verdict": "flag",
     "summary": "Flagged medical_intake_form.docx (date of birth, medication list) before upload to ChatGPT. User shared anyway."},
    {"time": "2026-09-18T15:03:00Z", "type": "spending", "verdict": "flag",
     "summary": "Midjourney subscription used twice this month ($10). Suggested pausing it."},
    {"time": "2026-09-19T12:27:00Z", "type": "data_sharing", "verdict": "flag",
     "summary": "Flagged bank_statement_aug.csv (account number) before upload to Claude. User removed the file."},
    {"time": "2026-09-21T19:10:00Z", "type": "tool_selection", "verdict": "recommendation",
     "summary": "User asked for a logo in ChatGPT. Suggested Midjourney for image generation."},
    {"time": "2026-09-23T14:02:00Z", "type": "data_sharing", "verdict": "safe",
     "summary": "Checked group_project_outline.md before upload to Gemini. Nothing personal found."},
    {"time": "2026-09-24T22:15:00Z", "type": "data_sharing", "verdict": "flag",
     "summary": "Flagged lease_agreement.pdf (home address, full name) before upload to ChatGPT. User removed the file."},
]
