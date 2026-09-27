// Proxies API calls for the content script. HTTPS pages (chatgpt.com etc.) can't
// fetch http://localhost directly (mixed content), but the service worker can.
const API_BASE = "http://localhost:5050";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind !== "connie-api") return;
  fetch(API_BASE + msg.path, {
    method: msg.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: msg.body ? JSON.stringify(msg.body) : undefined,
  })
    .then((r) => r.json())
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});
