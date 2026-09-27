// Connie herself: the character, her moods, and her speech bubble.
// Shared by the extension (content.js), the demo page, and the dashboard.
//
//   const connie = ConnieUI.mount({ cssHref, onPeekClick });
//   connie.think("Let me look at resume.pdf");
//   connie.say({ message, tip, mood, chips, actions, footnote, autoHideMs });
//   connie.peek();   // tuck back into the corner
//
// Moods: idle | thinking | cheerful | concerned | alarmed
(() => {
  if (window.ConnieUI) return;

  const SVG = `
  <svg class="c-svg" viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <radialGradient id="c-body-grad" cx="38%" cy="30%" r="78%">
        <stop offset="0" stop-color="#FF9DB0"/>
        <stop offset=".55" stop-color="#E8637A"/>
        <stop offset="1" stop-color="#C9485F"/>
      </radialGradient>
    </defs>
    <ellipse class="c-shadow" cx="60" cy="113" rx="30" ry="4.5"/>
    <g class="c-bounce">
      <g class="c-sprout">
        <path class="c-stem" d="M60 24 C 60 17 61 13 63 9"/>
        <path class="c-leaf" d="M61 15 C 51 6 42 10 44 16 C 50 19 56 18 61 15 Z"/>
        <path class="c-leaf" d="M63 10 C 71 0 81 4 79 10 C 73 14 67 13 63 10 Z"/>
      </g>
      <g class="c-arm c-arm-l"><ellipse cx="22" cy="74" rx="7" ry="10"/></g>
      <g class="c-arm c-arm-r">
        <ellipse cx="98" cy="74" rx="7" ry="10"/>
        <g class="c-glass">
          <line x1="104" y1="70" x2="112" y2="80"/>
          <circle cx="98" cy="62" r="9"/>
        </g>
      </g>
      <path class="c-body" d="M60 22 C 86 22 100 44 100 68 C 100 92 82 104 60 104 C 38 104 20 92 20 68 C 20 44 34 22 60 22 Z"/>
      <ellipse class="c-belly" cx="60" cy="86" rx="22" ry="13"/>
      <ellipse class="c-shine-body" cx="42" cy="40" rx="8" ry="5" transform="rotate(-30 42 40)"/>
      <g class="c-face">
        <path class="c-brow c-brow-l" d="M40 51 Q 46 48 52 50"/>
        <path class="c-brow c-brow-r" d="M68 50 Q 74 48 80 51"/>
        <g class="c-eyes">
          <g class="c-eye"><ellipse cx="47" cy="62" rx="5" ry="6.5"/><circle class="c-glint" cx="45.2" cy="59.6" r="1.8"/></g>
          <g class="c-eye"><ellipse cx="73" cy="62" rx="5" ry="6.5"/><circle class="c-glint" cx="71.2" cy="59.6" r="1.8"/></g>
        </g>
        <ellipse class="c-blush" cx="37" cy="74" rx="6" ry="3.5"/>
        <ellipse class="c-blush" cx="83" cy="74" rx="6" ry="3.5"/>
        <path class="c-mouth m-smile" d="M53 76 Q 60 83 67 76"/>
        <path class="c-mouth m-grin" d="M51 75 Q 60 89 69 75 Z"/>
        <path class="c-mouth m-worry" d="M52 80 Q 56 76 60 80 Q 64 84 68 80"/>
        <ellipse class="c-mouth m-o" cx="60" cy="80" rx="4.5" ry="5.5"/>
        <path class="c-mouth m-think" d="M55 80 Q 60 78 65 77"/>
        <path class="c-sweat" d="M91 40 C 95 46 96 50 93 52 C 90 54 87 51 89 47 Z"/>
      </g>
      <g class="c-sparkles">
        <path d="M16 30 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z"/>
        <path d="M103 22 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 z"/>
        <path d="M108 50 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2 z"/>
      </g>
    </g>
  </svg>`;

  function mount({ cssHref, onPeekClick } = {}) {
    const host = document.createElement("div");
    host.className = "connie-host";
    // Hidden until the stylesheet is in, so the page never sees unstyled Connie.
    host.style.cssText = "position: fixed; z-index: 2147483647; visibility: hidden;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <div class="connie preload" data-state="peek" data-mood="idle">
        <div class="bubble" role="status" aria-live="polite">
          <p class="eyebrow">Connie</p>
          <p class="msg"></p>
          <p class="tip"><span>Try this</span><span class="tip-text"></span></p>
          <ul class="chips"></ul>
          <div class="actions"></div>
          <p class="footnote"></p>
        </div>
        <button class="avatar" aria-label="Connie">${SVG}</button>
      </div>`;
    document.body.appendChild(host);

    const root = shadow.querySelector(".connie");

    // A constructable stylesheet: applied synchronously once fetched, and not
    // subject to the host page's CSP the way an injected <style> can be.
    fetch(cssHref)
      .then((r) => r.text())
      .then((css) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
        host.style.visibility = "";
        // Let first paint happen without transitions, then allow them.
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("preload")));
      })
      .catch((err) => console.warn("[Connie] couldn't load styles", err));
    const $ = (s) => shadow.querySelector(s);
    const svg = $(".c-svg");
    let hideTimer;

    // Eyes follow the cursor (a few px at most).
    document.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.52);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 300);
      svg.style.setProperty("--lx", ((dx / d) * 2.6 * k).toFixed(2) + "px");
      svg.style.setProperty("--ly", ((dy / d) * 2.2 * k).toFixed(2) + "px");
    }, { passive: true });

    function setState(state, mood) {
      clearTimeout(hideTimer);
      root.dataset.mood = mood;
      if (root.dataset.state !== state) {
        root.dataset.state = state;
      } else if (state === "open") {
        // Replay the bubble animation for a new message.
        root.dataset.state = "open-again";
        void root.offsetWidth;
        root.dataset.state = "open";
      }
    }

    function fill({ message = "", tip = "", chips = [], actions = [], footnote = "", thinking = false }) {
      const msg = $(".msg");
      msg.textContent = message;
      msg.classList.toggle("dots", thinking);
      $(".tip").hidden = !tip;
      $(".tip-text").textContent = tip;
      $(".chips").replaceChildren(...chips.map((c) => Object.assign(document.createElement("li"), { textContent: c })));
      $(".actions").replaceChildren(...actions.map(({ label, primary, onClick }) => {
        const b = Object.assign(document.createElement("button"), { textContent: label, type: "button" });
        if (primary) b.className = "primary";
        b.addEventListener("click", () => { api.peek(); onClick?.(); });
        return b;
      }));
      $(".footnote").textContent = footnote;
    }

    const api = {
      el: host,
      think(message) {
        fill({ message, thinking: true });
        setState("open", "thinking");
      },
      say({ mood = "cheerful", autoHideMs, ...content }) {
        fill(content);
        setState("open", mood);
        if (autoHideMs) hideTimer = setTimeout(api.peek, autoHideMs);
      },
      peek() {
        setState("peek", "idle");
      },
      get isOpen() {
        return root.dataset.state === "open";
      },
    };

    $(".avatar").addEventListener("click", () => {
      if (api.isOpen) api.peek();
      else onPeekClick?.(api);
    });

    return api;
  }

  window.ConnieUI = { mount };
})();
