// Connie content script.
// Watches for files heading into an AI chat (file picker or drag-and-drop),
// asks the backend to check them, and pops Connie in with advice + actions.
//
// Runs two ways:
//   1. As a real MV3 content script (API calls go through background.js)
//   2. As a plain <script> on /demo, the "simulated extension" fallback (direct fetch)
(() => {
  // Shared DOM marker so the extension and the demo page's copy don't both run.
  if (document.documentElement.dataset.connie) return;
  document.documentElement.dataset.connie = "on";

  const API_BASE = "http://localhost:5050";
  const isExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
  const TEXT_EXTS = /\.(txt|md|csv|json|env|log|html?|xml|ya?ml|py|js|ts|ini|cfg)$/i;
  const MAX_CHARS = 50_000;

  // --- API ------------------------------------------------------------------
  async function api(path, method = "GET", body) {
    if (isExtension) {
      const res = await chrome.runtime.sendMessage({ kind: "connie-api", path, method, body });
      if (!res?.ok) throw new Error(res?.error || "Connie backend unreachable");
      return res.data;
    }
    const r = await fetch(API_BASE + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function toolName() {
    const h = location.hostname;
    if (h.includes("chatgpt")) return "ChatGPT";
    if (h.includes("claude")) return "Claude";
    if (h.includes("gemini")) return "Gemini";
    return "the demo chat";
  }

  async function extractText(file) {
    if (file.type.startsWith("text/") || TEXT_EXTS.test(file.name) || file.name.startsWith(".")) {
      return (await file.text()).slice(0, MAX_CHARS);
    }
    // TODO: PDF/DOCX extraction (pdf.js / mammoth). For now Jev only sees the name.
    return `Filename: ${file.name}`;
  }

  // --- UI (Shadow DOM so host-page CSS can't touch Connie) --------------------
  const host = document.createElement("div");
  host.id = "connie-root";
  const shadow = host.attachShadow({ mode: "open" });
  const cssHref = isExtension ? chrome.runtime.getURL("connie.css") : "/extension/connie.css";
  shadow.innerHTML = `
    <link rel="stylesheet" href="${cssHref}">
    <div class="connie" data-state="hidden">
      <div class="bubble" role="status" aria-live="polite">
        <p class="eyebrow">Connie</p>
        <p class="msg"></p>
        <ul class="chips"></ul>
        <div class="actions"></div>
      </div>
      <button class="avatar" aria-label="Dismiss Connie">
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <path class="leaf" d="M40 16 C 36 6, 46 2, 50 6 C 48 12, 44 14, 40 16 Z"/>
          <circle class="body" cx="40" cy="45" r="29"/>
          <circle class="eye" cx="30" cy="42" r="3.6"/>
          <circle class="eye" cx="50" cy="42" r="3.6"/>
          <ellipse class="blush" cx="23" cy="52" rx="5" ry="3"/>
          <ellipse class="blush" cx="57" cy="52" rx="5" ry="3"/>
          <path class="smile" d="M33 53 Q 40 59 47 53"/>
        </svg>
      </button>
    </div>`;
  document.body.appendChild(host);

  const root = shadow.querySelector(".connie");
  const msgEl = shadow.querySelector(".msg");
  const chipsEl = shadow.querySelector(".chips");
  const actionsEl = shadow.querySelector(".actions");
  let hideTimer;

  function show({ message, tone = "flag", chips = [], actions = [], autoHideMs }) {
    clearTimeout(hideTimer);
    root.dataset.tone = tone;
    msgEl.textContent = message;
    chipsEl.replaceChildren(...chips.map((c) => Object.assign(document.createElement("li"), { textContent: c })));
    actionsEl.replaceChildren(
      ...actions.map(({ label, primary, onClick }) => {
        const b = Object.assign(document.createElement("button"), { textContent: label });
        if (primary) b.className = "primary";
        b.addEventListener("click", () => { hide(); onClick?.(); });
        return b;
      }),
    );
    root.dataset.state = "hidden";
    void root.offsetWidth; // restart the pop-in animation
    root.dataset.state = "shown";
    if (autoHideMs) hideTimer = setTimeout(hide, autoHideMs);
  }

  function hide() {
    root.dataset.state = "hidden";
  }
  shadow.querySelector(".avatar").addEventListener("click", hide);

  // --- Flow -----------------------------------------------------------------
  function log(type, summary, verdict) {
    api("/log", "POST", { time: new Date().toISOString(), type, summary, verdict }).catch(console.warn);
  }

  async function handleFiles(files, input) {
    if (!files.length) return;
    let settings, results;
    try {
      settings = await api("/settings");
      results = await Promise.all(
        files.map(async (file) => ({
          file,
          verdict: await api("/check-content", "POST", {
            text: await extractText(file),
            sensitivity: settings.dataSharing,
            fileName: file.name,
          }),
        })),
      );
    } catch (err) {
      console.warn("[Connie]", err);
      show({ tone: "safe", message: "I couldn't reach my brain just now, so I can't check this file. Is the backend running?", autoHideMs: 6000 });
      return;
    }

    const flagged = results.find((r) => r.verdict.choice === "flag");
    if (!flagged) {
      const { file, verdict } = results[0];
      show({ tone: "safe", message: verdict.message, autoHideMs: 5000, actions: [{ label: "Thanks, Connie!" }] });
      log("data_sharing", `Checked ${file.name} before upload to ${toolName()}. Nothing personal found.`, "safe");
      return;
    }

    const { file, verdict } = flagged;
    const base = `Flagged ${file.name} (${verdict.matches.join(", ")}) before upload to ${toolName()}.`;
    show({
      tone: "flag",
      message: verdict.message,
      chips: verdict.matches,
      actions: [
        {
          label: "Remove file",
          primary: true,
          onClick: () => {
            if (input) input.value = "";
            // The demo page listens for this; string detail survives the isolated-world boundary.
            document.dispatchEvent(new CustomEvent("connie:remove-file", { detail: file.name }));
            log("data_sharing", `${base} User removed the file.`, "flag");
          },
        },
        { label: "Share anyway", onClick: () => log("data_sharing", `${base} User shared anyway.`, "flag") },
      ],
    });
  }

  // Capture phase so we see the files before the page's own handlers.
  document.addEventListener("change", (e) => {
    const input = e.target;
    if (input instanceof HTMLInputElement && input.type === "file") {
      handleFiles(Array.from(input.files || []), input);
    }
  }, true);

  document.addEventListener("drop", (e) => {
    handleFiles(Array.from(e.dataTransfer?.files || []), null);
  }, true);
})();
