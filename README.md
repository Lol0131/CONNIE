# CONNIE
Connie is a friendly animated AI agent that lives in a browser extension and web app and helps everyday people stay in control of how they use AI. She watches for risky files before they get shared with AI tools, then explains the risk in plain English and tells you what to do next.

Built at ShellHacks 2026 at FIU.

## The Problem

Most people use AI tools without really knowing what happens to their data, how much they are spending, or whether a tool is the right choice for the job. The warnings that do exist are usually buried in long policies written for lawyers. Connie turns all of that into short, clear advice that anyone can act on.

## What Connie Does

* Scans files for dangerous or risky content before they reach an AI tool
* Turns a structured risk verdict into plain English advice
* Gives actionable next steps instead of vague warnings
* Lets you control how protective she is with three simple sliders

## Settings

Connie is built around three pillars, and each one is controlled by a single slider:

| Pillar | What it controls |
| ------ | ---------------- |
| Data sharing sensitivity | How carefully Connie treats the information you share with AI tools |
| Spending strictness | How closely Connie watches and flags what you spend on AI |
| Tool assertiveness | How strongly Connie pushes back or suggests a better tool |

## How It Works

1. The browser extension detects AI related activity and flags risky files.
2. The backend stores and analyzes activity using Snowflake.
3. Jev AI by TypeSafe AI produces a fast, structured risk verdict on each flagged file.
4. The Gemini API turns that verdict into Connie's plain English advice.
5. Connie shows the advice to the user through the extension and web app.

## Tech Stack

* Browser extension and web app for the front end
* Snowflake for the backend
* Gemini API for the AI logic
* Jev AI by TypeSafe AI for structured risk verdicts

## Hackathon Challenges

Connie was built for these ShellHacks 2026 challenges:

* Assurant: Take Control of AI
* MLH: Best Use of Gemini API
* MLH: Best Use of Snowflake API

## Getting Started

```bash
git clone https://github.com/Lol0131/CONNIE.git
cd CONNIE
```

Add your setup steps here, for example:

1. Install dependencies
2. Add your API keys to a local environment file
3. Start the web app
4. Load the extension in your browser by opening chrome://extensions, turning on Developer mode, and choosing Load unpacked

## Team

Built by [add teammate names and GitHub links here].

## What's Next

[Add a few ideas here, like more file types, more AI tools supported, or a mobile version.]
