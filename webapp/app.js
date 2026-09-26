// Connie dashboard. Talks to the backend described in API_CONTRACT.md.
const API_BASE = "http://localhost:5050";
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

// Pillar 2 runs on mock data for the demo (see README: "real vs. fake").
const BUDGET = 60;
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

let settings = { dataSharing: "medium", spending: "medium", toolAssertiveness: "low" };

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
const connie = $("#connie");
let hideTimer;
function say(message, { actions = [], autoHideMs = 6000 } = {}) {
  clearTimeout(hideTimer);
  connie.querySelector(".msg").textContent = message;
  connie.querySelector(".actions").replaceChildren(
    ...actions.map(({ label, primary, onClick }) => {
      const b = el("button", { textContent: label, className: primary ? "primary" : "" });
      b.onclick = () => { hush(); onClick?.(); };
      return b;
    }),
  );
  connie.dataset.state = "hidden";
  void connie.offsetWidth;
  connie.dataset.state = "shown";
  if (autoHideMs) hideTimer = setTimeout(hush, autoHideMs);
}
const hush = () => (connie.dataset.state = "hidden");
connie.querySelector(".avatar").onclick = hush;

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

  if (total > BUDGET) findings.push({ text: `You're $${total - BUDGET} over your $${BUDGET} monthly budget.` });

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
  $("#spendBudget").textContent = `Budget $${BUDGET}`;
  const fill = $("#spendBar");
  fill.style.width = Math.min(100, (total / BUDGET) * 100) + "%";
  fill.classList.toggle("over", total > BUDGET);

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
    if (settings.toolAssertiveness === "high") say(`Quick thought: ${pick} might be better for this. ${reason}`);
  }, 900);
});

// --- History (Cortex Search in the real build) ---------------------------------
const TYPE_LABEL = { data_sharing: "Data", spending: "Spending", tool_selection: "Tools" };

async function loadHistory(q = "") {
  const list = $("#entries");
  try {
    const rows = await api("/search?q=" + encodeURIComponent(q));
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
  } catch (e) {
    console.warn(e);
    list.replaceChildren(el("li", { className: "empty", textContent: "Couldn't load history. Is the backend running?" }));
  }
}

$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  loadHistory($("#q").value.trim());
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
