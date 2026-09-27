// Toolbar popup: quick sliders (synced through the backend) and a peek at Connie.
const API_BASE = "http://localhost:5050";
const LEVELS = ["low", "medium", "high"];
const REACTIONS = {
  dataSharing: {
    low: "Okay! I'll only stop you for the big stuff, like IDs and passwords.",
    medium: "Got it. I'll also watch for addresses, phone numbers, and emails.",
    high: "Extra careful mode! I'll flag names, schools, and anything personal.",
  },
  spending: {
    low: "I'll only speak up if you go over budget.",
    medium: "I'll point out subscriptions that do the same job.",
    high: "I'll flag every overlap and anything you barely use.",
  },
  toolAssertiveness: {
    low: "I'll keep tool tips to myself unless you ask.",
    medium: "I'll leave quiet tool suggestions while you type.",
    high: "I'll pop in when a different tool would do better!",
  },
};

const status = document.getElementById("status");
let settings = null;

const connie = ConnieUI.mount({
  cssHref: chrome.runtime.getURL("connie.css"),
  onPeekClick: (c) => c.say({
    mood: "cheerful",
    message: settings ? "I'm watching for files you share with AI tools. Slide these to tell me how careful to be!" : "I can't reach my backend. Start it with python app.py.",
    autoHideMs: 5000,
  }),
});

async function api(path, method = "GET", body) {
  const r = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function render() {
  document.querySelectorAll(".slider").forEach((box) => {
    const level = settings[box.dataset.key];
    box.querySelector("input").value = LEVELS.indexOf(level);
    box.querySelector(".level").textContent = level;
  });
}

document.querySelectorAll(".slider input").forEach((input) => {
  const key = input.closest(".slider").dataset.key;
  input.addEventListener("input", () => {
    if (!settings) return;
    settings[key] = LEVELS[input.value];
    render();
  });
  input.addEventListener("change", async () => {
    if (!settings) return;
    try {
      await api("/settings", "POST", { [key]: settings[key] });
      connie.say({ mood: "cheerful", message: REACTIONS[key][settings[key]], autoHideMs: 3500 });
    } catch {
      connie.say({ mood: "concerned", message: "Hmm, I couldn't save that. Is my backend running?", autoHideMs: 4000 });
    }
  });
});

document.getElementById("dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: `${API_BASE}/app/` });
});

(async () => {
  try {
    settings = await api("/settings");
    status.className = "status ok";
    status.textContent = "Watching your uploads";
    render();
  } catch {
    status.className = "status err";
    status.textContent = "Backend offline";
    document.querySelectorAll(".slider input").forEach((i) => (i.disabled = true));
  }
})();
