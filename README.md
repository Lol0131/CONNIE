# Connie

**ShellHacks 2026** · Assurant "Take Control of AI" · MLH Gemini API · MLH Snowflake API

Connie is a cute, animated AI helper that lives in a **browser extension** and a **web app**. She checks files *before* you share them with an AI tool, keeps an eye on what you spend on AI, and tells you when a different tool would do the job better. Three sliders let you decide how careful she is.

> *Jev decides fast, Gemini explains kindly, Snowflake remembers.*

---

## Quick start

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # fill in keys when you wire real services
.venv/bin/python app.py     # http://localhost:5050
```

Then open:

| URL | What it is |
|---|---|
| http://localhost:5050/demo/ | Mock AI chat with Connie running. Click **Try a sample → resume.txt**. |
| http://localhost:5050/app/ | Dashboard: sliders, spending, tool picker, history search |

The backend serves both pages, so one command runs the whole demo. Everything works right now on **stubbed logic** (see [What's real vs. stubbed](#whats-real-vs-stubbed)).

### Loading the real extension (optional)

1. Chrome → `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → pick the `extension/` folder
3. Keep the backend running. The extension works on `/demo/`, chatgpt.com, claude.ai, and gemini.google.com.

If packaging gives you trouble, the `/demo/` page already runs the same `content.js` as a plain script, which is the "simulated extension" fallback from the plan.

---

## Repo layout

```
API_CONTRACT.md        ← the endpoint shapes everyone builds against. Change it here first.
backend/               Role 1: Flask API (the shared brain)
  app.py               all endpoints + TODO(jev|gemini|snowflake) markers
  connie/rules.py      regex detector (Jev fallback) + template messages (Gemini stand-in)
  connie/seed.py       13 fake history entries (mirrors snowflake/02_seed.sql)
extension/             Role 2: Chrome MV3 extension
  content.js           watches file inputs + drag-and-drop, shows Connie (Shadow DOM)
  background.js        proxies API calls (HTTPS sites can't fetch http://localhost)
  connie.css           Connie's avatar, bubble, animations (web app reuses it)
  demo/                mock AI chat page + sample files
webapp/                Role 3: dashboard (plain HTML/CSS/JS, no build step)
snowflake/             run in order in a Snowsight worksheet
  01_schema.sql        warehouse, DB, USER_CONNIE_SETTINGS, INTERACTIONS
  02_seed.sql          demo user + 13 seeded interactions
  03_cortex.sql        Cortex Search service + smoke test + Cortex COMPLETE example
```

---

## How the sliders change behavior

| Pillar | Slider | Low | Medium | High |
|---|---|---|---|---|
| **Data sharing** | Sensitivity | SSN, cards, passwords, API keys | + email, phone, address, DOB | + names, schools/employers, ZIP, health |
| **Spending** | Strictness | Over budget only | + 3+ tools doing the same job | + any overlap, barely-used tools |
| **Tool selection** | Assertiveness | Only when you click Ask | Quiet suggestion while typing | Connie pops in while typing |

**Demo beat (tested):** with sensitivity on **medium**, `lecture_notes.txt` comes back safe. Slide it to **high** in the dashboard, attach it again, and Connie flags the name and school. `resume.txt` goes from 1 match on low to 4 on medium to 7 on high.

---

## What's real vs. stubbed

The stubs return exactly the shapes in `API_CONTRACT.md`, so the frontends won't need changes when real logic lands.

| Piece | Now | To do | Owner |
|---|---|---|---|
| `/check-content` verdict | Regex rules (`connie/rules.py`) | Call Jev; keep the rules as fallback | Backend |
| Connie's message | Template text | **Gemini structured output** (required) | Backend |
| `/search` | Keyword match over in-memory list | **Cortex Search REST query** (required) | Backend |
| `/log`, `/settings` | In-memory, resets on restart | Snowflake `INTERACTIONS` / `USER_CONNIE_SETTINGS` | Backend |
| `/recommend-tool` | Keyword match | Jev `choice` over tool list + Gemini reason | Backend |
| Spending data | Mock subscriptions in `webapp/app.js` | Fine for the demo | Web app |
| "Training on your chats" toggles | UI-only, logs the action | Fine for the demo (say so if judges ask) | Web app |
| PDF/DOCX text extraction | Sends filename only | pdf.js / mammoth if time allows | Extension |

### Wiring notes

**Jev.** The request shape in the original planning chat (`answer_space`) is wrong. The real endpoint is `POST https://api.typesafe.ai/v1/systemone` with `state`, `model` (e.g. `jev-latest`), and a `questions` object. Each question has a `type` (`choice`, `noul`, or `score`), `instructions`, and `criteria`. Check the TypeSafe docs and **test your key and rate limits early**. It's also on OpenRouter.

**Gemini.** Pass the verdict (`choice`, `category`, `matches`), the slider level, and the filename. Ask for a JSON response schema like `{ "message": string }`, written in Connie's voice: warm, brief, like a friend giving a heads-up. It should mention the slider when relevant ("You have sensitivity set to high, so…").

**Snowflake.** Run `snowflake/01` → `02` → `03`. If the `SEARCH_PREVIEW` smoke test in `03_cortex.sql` returns rows, the REST call will too. Build priority #1 in the plan: do this first, since it's the part most likely to eat time.

---

## Demo script (~3 min)

1. Open `/demo/` → **Try a sample → resume.txt** → Connie pops in and flags the SSN, address, and phone.
2. Click **Remove file**: a real action, and the file disappears.
3. Open `/app/`, slide **Sensitivity** to high → back to `/demo/` → attach `lecture_notes.txt` → now it's flagged.
4. Show **Spending** (pause a duplicate subscription) and **Tool selection** (type "summarize a 200-page PDF").
5. **Ask your history:** "when did I share my address?" → answered from Snowflake Cortex Search.

---

## Design

Sage `#EEF3EA` · Plum `#2E2440` · Coral `#E8637A` (Connie) · Gold `#D9A441` (settings) · Charcoal `#5C5568`.
Fraunces for Connie's voice and headings, Inter for UI. Warm and trustworthy, like a smart friend, not an alarm system.
