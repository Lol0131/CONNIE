// Connie dashboard. Talks to the backend described in API_CONTRACT.md.
// Served by the backend, so call our own origin.
const API_BASE = location.origin;
const LEVELS = ["low", "medium", "high"];

const EXPLAIN = {
  dataSharing: {
    low: "Only flags the obvious: SSNs, card numbers, passwords, API keys.",
    medium: "Also flags contact info: email, phone, home address, date of birth.",
    high: "Flags anything remotely personal, including names, schools, and health details.",
  },
  spending: {
    low: "Only speaks up when you go over budget.",
    medium: "Also flags when several subscriptions do the same job.",
    high: "Flags any overlap, plus tools you barely use.",
  },
  toolAssertiveness: {
    low: "Only suggests a tool when you ask.",
    medium: "Shows a quiet suggestion while you type.",
    high: "Pops in to suggest a better tool while you type.",
  },
};

// Pillar 2's subscriptions are mock data for the demo; the budget is the user's own.
const DEFAULT_BUDGET = 60;
const budget = () => settings.monthlyBudget ?? DEFAULT_BUDGET;
const subscriptions = [
  { name: "ChatGPT Plus", cost: 20, use: "writing", hoursThisMonth: 14 },
  { name: "Claude Pro", cost: 20, use: "writing", hoursThisMonth: 9 },
  { name: "Gemini Advanced", cost: 20, use: "writing", hoursThisMonth: 3 },
  { name: "GitHub Copilot", cost: 10, use: "code", hoursThisMonth: 22 },
  { name: "Midjourney", cost: 10, use: "images", hoursThisMonth: 1 },
];

const training = [
  { tool: "ChatGPT", on: true },
  { tool: "Claude", on: true },
  { tool: "Gemini", on: true },
];

let settings = { dataSharing: "medium", spending: "medium", toolAssertiveness: "low", monthlyBudget: DEFAULT_BUDGET };

// --- helpers -----------------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

async function api(path, method = "GET", body) {
  const r = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

function log(type, summary, verdict) {
  api("/log", "POST", { time: new Date().toISOString(), type, summary, verdict })
    .then(() => { if (!$("#q").value) loadHistory(); })
    .catch(console.warn);
}

function setStatus(ok) {
  const s = $("#status");
  s.className = "status " + (ok ? "ok" : "err");
  s.textContent = ok ? "Connected" : "Backend offline";
}

// --- Connie ------------------------------------------------------------------
const connie = ConnieUI.mount({
  cssHref: "/extension/connie.css",
  onPeekClick: (c) => c.say({
    mood: "cheerful",
    message: "Hi! This is your AI dashboard. Slide the settings on the left to tell me how careful to be.",
    autoHideMs: 5000,
  }),
});
const say = (message, { mood = "cheerful", autoHideMs = 6000, ...rest } = {}) =>
  connie.say({ message, mood, autoHideMs, ...rest });

// --- Sliders -----------------------------------------------------------------
function renderSliders() {
  document.querySelectorAll(".slider").forEach((box) => {
    const key = box.dataset.key;
    const level = settings[key];
    box.querySelector("input").value = LEVELS.indexOf(level);
    box.querySelector(".level").textContent = level;
    box.querySelector(".explain").textContent = EXPLAIN[key][level];
  });
}

document.querySelectorAll(".slider input").forEach((input) => {
  const key = input.closest(".slider").dataset.key;
  input.addEventListener("input", () => {
    settings[key] = LEVELS[input.value];
    renderSliders();
    if (key === "spending") renderSpending();
  });
  input.addEventListener("change", async () => {
    try {
      await api("/settings", "POST", { [key]: settings[key] });
      setStatus(true);
    } catch (e) {
      console.warn(e);
      setStatus(false);
    }
  });
});

// --- Training toggles (demo-only: flips our UI, not the real vendor setting) ---
function renderTraining() {
  $("#training").replaceChildren(
    ...training.map((t) => {
      const sw = el("button", { className: "switch", role: "switch", title: `Let ${t.tool} train on my chats` });
      sw.setAttribute("aria-checked", t.on);
      sw.setAttribute("aria-label", `Let ${t.tool} train on my chats`);
      sw.onclick = () => {
        t.on = !t.on;
        renderTraining();
        say(t.on
          ? `${t.tool} can use your chats for training again.`
          : `Done! ${t.tool} won't train on your chats anymore.`);
        log("data_sharing", `Turned ${t.on ? "on" : "off"} model training for ${t.tool}.`, "action");
      };
      return el("li", {}, el("span", { textContent: t.tool }), sw);
    }),
  );
}

// --- Pillar 2: spending --------------------------------------------------------
function spendingFindings() {
  const active = subscriptions.filter((s) => !s.paused);
  const total = active.reduce((n, s) => n + s.cost, 0);
  const level = LEVELS.indexOf(settings.spending);
  const findings = [];

  if (total > budget()) findings.push({ text: `You're ${money(total - budget())} over your ${money(budget())} monthly budget.` });

  const byUse = Object.groupBy(active, (s) => s.use);
  for (const [use, subs] of Object.entries(byUse)) {
    const threshold = level >= 2 ? 2 : 3; // high flags any overlap, medium only heavy overlap
    if (level >= 1 && subs.length >= threshold) {
      const leastUsed = subs.reduce((a, b) => (a.hoursThisMonth <= b.hoursThisMonth ? a : b));
      findings.push({
        text: `${subs.length} subscriptions all used for ${use}. ${leastUsed.name} gets the least use (${leastUsed.hoursThisMonth}h).`,
        pause: leastUsed,
      });
    }
  }

  if (level >= 2) {
    active
      .filter((s) => s.hoursThisMonth <= 2 && !findings.some((f) => f.pause === s))
      .forEach((s) => findings.push({ text: `${s.name} was used ${s.hoursThisMonth}h this month for $${s.cost}.`, pause: s }));
  }
  return { total, findings };
}

function renderSpending() {
  const { total, findings } = spendingFindings();
  $("#spendTotal").textContent = `$${total}/mo`;
  const input = $("#budgetInput");
  if (document.activeElement !== input) input.value = budget();
  const fill = $("#spendBar");
  fill.style.width = (budget() > 0 ? Math.min(100, (total / budget()) * 100) : 100) + "%";
  fill.classList.toggle("over", total > budget());

  $("#subs").replaceChildren(
    ...subscriptions.map((s) =>
      el("li", { className: s.paused ? "paused" : "" },
        el("span", {}, s.name, el("span", { className: "use", textContent: ` · ${s.use}, ${s.hoursThisMonth}h` })),
        el("span", { textContent: `$${s.cost}` }),
        s.paused ? el("button", { className: "btn small", textContent: "Resume", onclick: () => { s.paused = false; renderSpending(); } }) : el("span"),
      ),
    ),
  );

  $("#findings").replaceChildren(
    ...(findings.length
      ? findings.map((f) => {
          const li = el("li", {}, el("span", { textContent: f.text }));
          if (f.pause) {
            li.append(el("button", {
              className: "btn small",
              textContent: `Pause ${f.pause.name}`,
              onclick: () => {
                f.pause.paused = true;
                renderSpending();
                say(`Paused ${f.pause.name}. That saves you $${f.pause.cost} a month.`);
                log("spending", `Paused ${f.pause.name} ($${f.pause.cost}/mo). ${f.text}`, "action");
              },
            }));
          }
          return li;
        })
      : [el("li", { className: "ok", textContent: "Nothing to flag at this strictness. Nice!" })]),
  );
}

const money = (n) => "$" + (Number.isInteger(n) ? n : n.toFixed(2));

// The budget is the user's call: saved with their settings, and Connie reacts.
function budgetReaction() {
  const { total } = spendingFindings();
  const b = budget();
  if (total > b) {
    return { mood: "concerned", message: `Got it, ${money(b)} a month. You're ${money(total - b)} over right now. Want to pause something below?` };
  }
  if (total >= b * 0.9) {
    return { mood: "concerned", message: `Got it, ${money(b)} a month. You're at ${money(total)}, so right at the edge. I'll let you know if that changes.` };
  }
  return { mood: "cheerful", message: `Got it, ${money(b)} a month. You're at ${money(total)}, with ${money(b - total)} to spare. Nice!` };
}

$("#budgetInput").addEventListener("input", (e) => {
  const v = Number(e.target.value);
  const ok = e.target.value !== "" && v >= 0 && v <= 10000;
  e.target.classList.toggle("invalid", !ok);
  if (ok) {
    settings.monthlyBudget = v;
    renderSpending();
  }
});

$("#budgetInput").addEventListener("change", async (e) => {
  const v = Number(e.target.value);
  if (e.target.value === "" || !(v >= 0 && v <= 10000)) {
    e.target.value = budget();
    e.target.classList.remove("invalid");
    return say("Budgets need to be between $0 and $10,000. I kept your old one.", { mood: "concerned" });
  }
  try {
    await api("/settings", "POST", { monthlyBudget: v });
    setStatus(true);
    say(budgetReaction().message, { mood: budgetReaction().mood });
    log("spending", `Set monthly AI budget to ${money(v)}.`, "action");
  } catch (err) {
    console.warn(err);
    setStatus(false);
    say("I couldn't save your budget. Is my backend running?", { mood: "concerned" });
  }
});

// --- Pillar 3: tool selection ------------------------------------------------
async function recommend(task) {
  const { pick, reason } = await api("/recommend-tool", "POST", { task });
  const box = $("#pick");
  box.hidden = false;
  box.replaceChildren(el("strong", { textContent: `Try ${pick}` }), el("p", { textContent: reason }));
  return { pick, reason };
}

$("#toolForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const task = $("#task").value.trim();
  if (!task) return;
  const { pick, reason } = await recommend(task);
  log("tool_selection", `User asked which tool to use for "${task}". Suggested ${pick}. ${reason}`, "recommendation");
});

let typingTimer;
$("#task").addEventListener("input", () => {
  clearTimeout(typingTimer);
  const task = $("#task").value.trim();
  if (settings.toolAssertiveness === "low" || task.length < 12) return;
  typingTimer = setTimeout(async () => {
    const { pick, reason } = await recommend(task);
    if (settings.toolAssertiveness === "high") say(`Quick thought: ${pick} might be better for this. ${reason}`, { mood: "concerned" });
  }, 900);
});

// --- History (Cortex Search in the real build) ---------------------------------
const TYPE_LABEL = { data_sharing: "Data", spending: "Spending", tool_selection: "Tools" };

function renderEntries(rows) {
  const list = $("#entries");
  list.replaceChildren(
      ...(rows.length
        ? rows.map((r) =>
            el("li", {},
              el("div", { className: "meta" },
                el("span", { className: "badge", textContent: TYPE_LABEL[r.type] || r.type }),
                el("span", { className: `badge ${r.verdict}`, textContent: r.verdict }),
                el("time", { textContent: new Date(r.time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) }),
              ),
              r.summary,
            ),
          )
        : [el("li", { className: "empty", textContent: "Nothing in your history matches that." })]),
  );
}

async function loadHistory() {
  $("#listLabel").textContent = "Recent activity";
  try {
    renderEntries(await api("/search"));
  } catch (e) {
    console.warn(e);
    $("#entries").replaceChildren(el("li", { className: "empty", textContent: "Couldn't load history. Is the backend running?" }));
  }
}

// Ask your history: Cortex Search finds the entries, Cortex COMPLETE answers.
$("#searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("#q").value.trim();
  if (!q) return loadHistory();
  const box = $("#answer"), text = $("#answerText");
  box.hidden = false;
  text.className = "answer-text loading";
  text.textContent = "Looking through your history…";
  $("#answerEngine").textContent = "";
  try {
    const { answer, sources, engine } = await api("/ask?q=" + encodeURIComponent(q));
    text.className = "answer-text";
    text.textContent = answer;
    $("#answerEngine").textContent = {
      cortex: "Found by Snowflake Cortex Search · answered by Cortex",
      "snowflake-vector": "Found by Snowflake vector search · answered by Gemini",
    }[engine] || "Snowflake isn't connected, so this is a simple local search";
    $("#listLabel").textContent = "What I found";
    renderEntries(sources);
  } catch (err) {
    console.warn(err);
    text.className = "answer-text";
    text.textContent = "I couldn't search your history just now. Is the backend running?";
  }
});

// --- Boot ------------------------------------------------------------------------
(async () => {
  try {
    settings = await api("/settings");
    setStatus(true);
  } catch (e) {
    console.warn(e);
    setStatus(false);
  }
  renderSliders();
  renderTraining();
  renderSpending();
  loadHistory();
})();
