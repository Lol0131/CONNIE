// Connie content script.
// Watches for files heading into an AI chat (file picker or drag-and-drop),
// asks the backend to check them, and has Connie react with advice + actions.
//
// Runs two ways:
//   1. As a real MV3 content script (API calls go through background.js)
//   2. As a plain <script> on /demo, the "simulated extension" fallback (direct fetch)
// Needs connie-ui.js loaded first.
(() => {
  // Shared DOM marker so the extension and the demo page's copy don't both run.
  if (document.documentElement.dataset.connie) return;
  document.documentElement.dataset.connie = "on";

  const isExtension = typeof chrome !== "undefined" && !!chrome.runtime?.id;
  // The demo page is served by the backend, so it can call its own origin.
  const API_BASE = isExtension ? "http://localhost:5050" : location.origin;
  const TEXT_EXTS = /\.(txt|md|csv|json|env|log|html?|xml|ya?ml|py|js|ts|ini|cfg)$/i;
  const RAW_EXTS = /\.(pdf|docx|png|jpe?g|webp|heic|heif)$/i;
  const MAX_CHARS = 50_000;
  const MAX_BYTES = 10 * 1024 * 1024;

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

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  // What to send /check-content for this file.
  async function payloadFor(file) {
    if (file.type.startsWith("text/") || TEXT_EXTS.test(file.name) || file.name.startsWith(".")) {
      return { text: (await file.text()).slice(0, MAX_CHARS) };
    }
    if ((RAW_EXTS.test(file.name) || file.type.startsWith("image/")) && file.size <= MAX_BYTES) {
      // PDFs, Word docs, and images are read by the backend (images via Gemini).
      return { fileBase64: toBase64(await file.arrayBuffer()), mimeType: file.type };
    }
    return { text: `Filename: ${file.name}` };
  }

  function engineNote(engine = {}) {
    const checked = engine.verdict === "jev" ? "Checked by Jev" : "Checked by Connie's quick rules";
    const worded = engine.voice === "gemini" ? "worded by Gemini" : "offline wording";
    const read = engine.extract === "gemini-vision" ? " · image read by Gemini" : "";
    return `${checked} · ${worded}${read}`;
  }

  // --- Connie ---------------------------------------------------------------
  const connie = ConnieUI.mount({
    cssHref: isExtension ? chrome.runtime.getURL("connie.css") : `${API_BASE}/extension/connie.css`,
    onPeekClick: showStatus,
  });

  async function showStatus() {
    connie.think("Checking in");
    try {
      const s = await api("/settings");
      connie.say({
        mood: "cheerful",
        message: `Hi! I'm keeping an eye on files you share with ${toolName()}. Your data-sharing sensitivity is ${s.dataSharing}.`,
        actions: [
          { label: "Open my dashboard", primary: true, onClick: () => window.open(`${API_BASE}/app/`, "_blank") },
          { label: "Back to work" },
        ],
      });
    } catch {
      connie.say({ mood: "concerned", message: "I can't reach my brain right now. Is the Connie backend running?", autoHideMs: 6000 });
    }
  }

  function log(type, summary, verdict) {
    api("/log", "POST", { time: new Date().toISOString(), type, summary, verdict }).catch(console.warn);
  }

  // --- Flow -----------------------------------------------------------------
  const CHECK_TIMEOUT_MS = 15000;
  const withTimeout = (p, ms) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), ms))]);

  // `gate.release()` lets the file through to the page; `gate.cancel()` drops it.
  async function handleFiles(files, gate) {
    const names = files.length === 1 ? files[0].name : `${files.length} files`;
    connie.think(`Hold on, let me take a look at ${names}`);

    let results;
    try {
      const settings = await api("/settings");
      results = await withTimeout(Promise.all(
        files.map(async (file) => ({
          file,
          verdict: await api("/check-content", "POST", {
            ...(await payloadFor(file)),
            sensitivity: settings.dataSharing,
            fileName: file.name,
          }),
        })),
      ), CHECK_TIMEOUT_MS);
    } catch (err) {
      // Fail open: never break the site because Connie is unavailable.
      console.warn("[Connie]", err);
      gate.release();
      connie.say({ mood: "concerned", message: "I couldn't check this one in time, so I let it through. Is my backend running?", autoHideMs: 7000 });
      return;
    }

    const flagged = results.find((r) => r.verdict.choice === "flag");
    if (!flagged) {
      gate.release();
      const { file, verdict } = results[0];
      connie.say({
        mood: "cheerful",
        message: verdict.message,
        footnote: engineNote(verdict.engine),
        actions: [{ label: "Thanks, Connie!" }],
        autoHideMs: 6000,
      });
      log("data_sharing", `Checked ${file.name} before upload to ${toolName()}. Nothing personal found.`, "safe");
      return;
    }

    const { file, verdict } = flagged;
    const base = `Flagged ${file.name} (${verdict.matches.join(", ")}) before upload to ${toolName()}.`;
    connie.say({
      mood: verdict.mood || "concerned",
      message: verdict.message,
      tip: verdict.tip,
      chips: verdict.matches,
      footnote: engineNote(verdict.engine),
      actions: [
        {
          label: "Remove file",
          primary: true,
          onClick: () => {
            gate.cancel();
            log("data_sharing", `${base} User removed the file.`, "flag");
            setTimeout(() => connie.say({ mood: "cheerful", message: "Removed. Nice call!", autoHideMs: 2500 }), 350);
          },
        },
        {
          label: "Share anyway",
          onClick: () => {
            gate.release();
            log("data_sharing", `${base} User shared anyway.`, "flag");
          },
        },
      ],
    });
  }

  // --- The gate --------------------------------------------------------------
  // Listen on window in the capture phase so Connie sees files before the page
  // does. The original event is stopped; on release a copy is re-dispatched, and
  // the page handles it exactly as if the user had just picked the file.
  const released = new WeakSet();
  const pending = new WeakSet(); // file inputs currently held

  function redispatch(target, event) {
    released.add(event);
    target.dispatchEvent(event);
  }

  function isFileInput(el) {
    return el instanceof HTMLInputElement && el.type === "file";
  }

  // Browsers fire `input` then `change` on a file pick; hold both.
  window.addEventListener("input", (e) => {
    if (isFileInput(e.target) && !released.has(e) && e.target.files?.length) e.stopImmediatePropagation();
  }, true);

  window.addEventListener("change", (e) => {
    const input = e.target;
    if (!isFileInput(input) || released.has(e)) return;
    const files = Array.from(input.files || []);
    if (!files.length || pending.has(input)) return;
    e.stopImmediatePropagation();
    pending.add(input);
    handleFiles(files, {
      release() {
        pending.delete(input);
        redispatch(input, new Event("input", { bubbles: true }));
        redispatch(input, new Event("change", { bubbles: true }));
      },
      cancel() {
        pending.delete(input);
        input.value = "";
      },
    });
  }, true);

  window.addEventListener("drop", (e) => {
    if (released.has(e)) return;
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    e.preventDefault(); // otherwise the browser opens the file in the tab
    e.stopImmediatePropagation();
    const { target, clientX, clientY } = e;
    handleFiles(files, {
      release() {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        redispatch(target, new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY }));
      },
      cancel() {},
    });
  }, true);

  // Pasting a file (e.g. a screenshot) into the chat box.
  window.addEventListener("paste", (e) => {
    if (released.has(e)) return;
    const files = Array.from(e.clipboardData?.files || []);
    if (!files.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.target;
    handleFiles(files, {
      release() {
        const dt = new DataTransfer();
        files.forEach((f) => dt.items.add(f));
        redispatch(target, new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
      },
      cancel() {},
    });
  }, true);
})();
