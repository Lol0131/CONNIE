# Connie API Contract

The backend, the extension, and the web app all build against this file. **If you change a shape, change it here in the same commit** and tell the team.

- Base URL (local): `http://localhost:5050`
- All bodies are JSON. All endpoints allow CORS.
- Slider levels are always one of `"low" | "medium" | "high"`.
- Fields marked *(added)* aren't in the original plan. They're optional for callers, and the backend always returns them.

---

## `POST /check-content`

Scans text pulled from a file the user is about to share. Pipeline: Jev (or the regex fallback) → Gemini → response.

Request
```json
{ "text": "Jane Doe\n123 Palm Ave...", "sensitivity": "medium", "fileName": "resume.txt" }
```
`fileName` *(added)*: optional, used in Connie's message and the log.

For PDFs, Word docs, and images, send the raw file instead of `text` *(added)*:
```json
{ "fileBase64": "JVBERi0xLjQK...", "fileName": "resume.pdf", "mimeType": "application/pdf", "sensitivity": "medium" }
```
The backend extracts text itself: PDF and DOCX locally, images via Gemini multimodal. Max 10 MB.

Response
```json
{
  "choice": "flag",
  "confidence": 0.93,
  "message": "Heads up! This file has your home address and phone number...",
  "tip": "Remove those lines before uploading.",
  "mood": "concerned",
  "category": "contact_info",
  "matches": ["street address", "phone number"],
  "engine": { "verdict": "rules", "voice": "gemini", "extract": "pdf" }
}
```
- `choice`: `"flag" | "safe"`
- `confidence`: number from 0 to 1
- `message`: Connie's plain-English advice, from Gemini structured output
- `tip` *(added)*: one short, concrete next step
- `mood` *(added)*: `"cheerful" | "concerned" | "alarmed"`. Drives Connie's facial expression.
- `category` *(added)*: `"government_id" | "financial" | "credentials" | "contact_info" | "personal_details" | "unreadable" | "none"`. `unreadable` means the backend couldn't extract the file, so Connie asks the user to check it rather than calling it safe.
- `matches` *(added)*: human-readable list of what was found
- `probabilities` *(added, only when Jev ran)*: Jev's yes-probability for each data category
- `engine` *(added)*: which parts were live. `verdict`: `"jev" | "rules"`; `voice`: `"gemini" | "template"`; `extract`: `"client" | "pdf" | "docx" | "gemini-vision" | "text" | "filename-only"`. Handy for debugging and for being honest in the demo.

Gemini can take 1–7 s, so callers should show a loading state.

---

## `POST /log`

Records one interaction. The backend writes it to Snowflake (`CONNIE.APP.INTERACTIONS`).

Request
```json
{
  "time": "2026-09-26T18:30:00Z",
  "type": "data_sharing",
  "summary": "Flagged resume.txt (address, phone) before upload to ChatGPT. User removed the file.",
  "verdict": "flag"
}
```
- `type`: `"data_sharing" | "spending" | "tool_selection"`
- `verdict`: free string, usually `"flag" | "safe" | "recommendation"`

Response: `{ "ok": true, "stored": "snowflake" }` (`"memory"` when Snowflake is off or unreachable)

---

## `GET /search?q=...`

"Ask your history." In the real build this runs a Cortex Search query over the interactions table. An empty `q` returns the most recent entries.

Response (newest first)
```json
[
  { "time": "2026-09-20T14:02:00Z", "type": "data_sharing", "summary": "Flagged tax_return_2025.pdf ...", "verdict": "flag" }
]
```

---

## `GET /ask?q=...` *(added)*

"Ask your history" as a real answer, not just a list. Cortex Search retrieves the matching interactions and Cortex COMPLETE writes Connie's reply from them (RAG, all inside Snowflake).

Response
```json
{
  "answer": "You shared your home address twice: your resume on Sep 10 and a lease on Sep 24.",
  "sources": [ { "time": "...", "type": "data_sharing", "summary": "...", "verdict": "flag" } ],
  "engine": "cortex"
}
```
`engine` is `"local"` when Snowflake is off. Then `answer` is a simple count and `sources` comes from keyword search. Takes 1–5 s, so show a loading state.

---

## `GET /settings`

Response
```json
{ "dataSharing": "medium", "spending": "medium", "toolAssertiveness": "low" }
```

## `POST /settings`

Request: the same shape as the `GET` response. Partial updates are allowed, and missing keys keep their current value.

Response: `{ "ok": true }`. Returns `400` if a value isn't `low`/`medium`/`high`.

Both the extension and the web app read `/settings` before acting, so they always agree.

---

## `POST /recommend-tool`

Request
```json
{ "task": "summarize a 200-page PDF" }
```

Response
```json
{ "pick": "Gemini", "reason": "Long-context model; it can take the whole PDF in one go." }
```
