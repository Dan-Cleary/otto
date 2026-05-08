// Otto feedback widget — vanilla JS, Daemon (paper + amber) skin.
//
// Inject with:
//   <script src="/path/to/otto.js"
//     data-endpoint="https://<your-convex>.convex.site/ingest/widget"
//     data-secret="..." defer></script>
//
// Style + voice come from the Otto identity handoff:
//   - Paper + amber palette
//   - VT323 display, JetBrains Mono body
//   - Pixel otter sprite (4 states) baked in as data URLs
//   - Square corners, hairline borders, 6px offset paper-deep shadow
//   - Lowercase, first-person, brief copy

// SVGs are base64-encoded at build time (esbuild --loader:.svg=base64).
// We wrap them as proper data: URIs here. Base64 (vs percent-encoded) is
// safe to drop into HTML src="..." attributes — no literal quotes.
import OTTER_IDLE_B64 from "./sprites/otter-idle.svg";
import OTTER_THINKING_B64 from "./sprites/otter-thinking.svg";
import OTTER_DONE_B64 from "./sprites/otter-done.svg";
import OTTER_ERROR_B64 from "./sprites/otter-error.svg";

const SVG_PREFIX = "data:image/svg+xml;base64,";
const OTTER_IDLE = SVG_PREFIX + OTTER_IDLE_B64;
const OTTER_THINKING = SVG_PREFIX + OTTER_THINKING_B64;
const OTTER_DONE = SVG_PREFIX + OTTER_DONE_B64;
const OTTER_ERROR = SVG_PREFIX + OTTER_ERROR_B64;

(() => {
  const currentScript = document.currentScript as HTMLScriptElement | null;
  const ENDPOINT = currentScript?.dataset.endpoint;
  const SECRET = currentScript?.dataset.secret;
  // Optional. When set, every event from this page is tagged with the
  // project id and routed there directly — bypassing URL-pattern
  // matching. Per-project snippets are the recommended install path.
  const PROJECT_ID = currentScript?.dataset.project ?? null;
  if (!ENDPOINT || !SECRET) {
    console.warn("[otto] missing data-endpoint or data-secret on script tag");
    return;
  }

  // Capture console errors so submitted feedback carries last-20 errors.
  const consoleErrors: string[] = [];
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      consoleErrors.push(args.map((a) => String(a)).join(" "));
      if (consoleErrors.length > 20) consoleErrors.shift();
    } catch {}
    origError(...args);
  };

  // ── Daemon palette ──────────────────────────────────────────────
  const BG = "#ece4d3";
  const PANEL = "#e2d8c2";
  const CREAM = "#f6efde";
  const AMBER = "#c89045";
  const AMBER_DIM = "#a87528";
  const HAIR = "#b8ad94";
  const INK = "#1c1a16";
  const PENCIL = "#6b6356";
  const GREEN = "#3d5440";
  const RED = "#a04a2c";

  // Load Daemon fonts (VT323 + JetBrains Mono). Idempotent — safe to
  // re-inject if the host already loaded them.
  if (!document.getElementById("otto-fonts")) {
    const link = document.createElement("link");
    link.id = "otto-fonts";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=VT323&display=swap";
    document.head.appendChild(link);
  }

  // Stack used inside the widget. We always include fallbacks so the
  // widget remains legible if Google Fonts is blocked on the host page.
  const FONT_DISPLAY = `"VT323", ui-monospace, monospace`;
  const FONT_MONO = `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

  const css = `
.otto-fab {
  position: fixed; bottom: 20px; right: 20px;
  z-index: 2147483646;
  background: ${BG};
  color: ${INK};
  border: 2px solid ${INK};
  box-shadow: 6px 6px 0 ${HAIR};
  padding: 8px 14px 8px 8px;
  font-family: ${FONT_DISPLAY};
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 10px;
  transition: transform 120ms cubic-bezier(.2,.8,.2,1),
              box-shadow 120ms cubic-bezier(.2,.8,.2,1);
}
.otto-fab:hover {
  transform: translate(-1px, -1px);
  box-shadow: 7px 7px 0 ${HAIR};
}
.otto-fab:active { transform: translate(2px, 2px); box-shadow: 4px 4px 0 ${HAIR}; }
.otto-fab .otto-face {
  position: relative;
  width: 32px; height: 32px;
  display: inline-block;
  /* Body stays still. Eyes and arms do the moving. (Keeping the
   * face position relative so absolute children — pupils + arms —
   * can be placed in sprite-pixel coordinates.) */
}
.otto-fab .otto-face img { width: 32px; height: 32px; image-rendering: pixelated; display: block; }
/* Pupils sit on top of the sprite's existing 2×1 ink eyes (grid y=7,
 * x=7..8 left, x=14..15 right). 1 grid pixel = 32/24 ≈ 1.333px. We
 * keep the pupil 1×1 grid; its travel is ±1 grid (a single eye-pixel
 * shift) so it stays inside the head silhouette. */
.otto-fab .otto-pupil {
  position: absolute;
  width: 1.34px; height: 1.34px;
  top: 9.33px;
  background: #1c1a16;
  animation: otto-look 12s steps(1, end) infinite;
  pointer-events: none;
}
.otto-fab .otto-pupil.l { left: 9.33px; }
.otto-fab .otto-pupil.r { left: 18.67px; }
/* Cream-colored "eye whites" sit just behind the pupils to mask the
 * original ink eye when the pupil glances away. Same paper tone as
 * the fab background so they read as the head, not a hole. */
.otto-fab .otto-eye-bg {
  position: absolute;
  width: 2.67px; height: 1.34px;
  top: 9.33px;
  background: #ece4d3;
  pointer-events: none;
}
.otto-fab .otto-eye-bg.l { left: 9.33px; }
.otto-fab .otto-eye-bg.r { left: 18.67px; }
/* Pause look-around when otto isn't idle. */
.otto-fab .otto-face.is-thinking,
.otto-fab .otto-face.is-done,
.otto-fab .otto-face.is-error { animation: none; transform: none; }
.otto-fab .otto-face:not(.is-idle) .otto-pupil,
.otto-fab .otto-face:not(.is-idle) .otto-eye-bg { display: none; }

.otto-fab-text { letter-spacing: .04em; padding-top: 3px; }

/* 12-second loop. Glance right around 4s, glance left around 8s. */
@keyframes otto-look {
  0%, 28%    { transform: translateX(0); }
  32%, 38%   { transform: translateX(1.34px); }   /* ~4s · right */
  42%, 62%   { transform: translateX(0); }
  66%, 72%   { transform: translateX(-1.34px); }  /* ~8s · left  */
  76%, 100%  { transform: translateX(0); }
}

/* Arm dance — arms are always visible at chest level; during the
 * dance segment (60–95% of the 5s loop) they see-saw, one up one
 * down. Body stays still. translateY(-12px) lifts the paw alongside
 * the head; +0 returns to default chest position. */
@media (prefers-reduced-motion: reduce) {
  .otto-fab .otto-face,
  .otto-fab .otto-pupil { animation: none !important; transform: none !important; }
}

.otto-overlay {
  position: fixed; inset: 0;
  background: rgba(28, 26, 22, 0.36);
  backdrop-filter: blur(2px);
  z-index: 2147483647;
  display: flex; align-items: center; justify-content: center;
  font-family: ${FONT_MONO};
}

.otto-modal {
  background: ${BG};
  background-image: linear-gradient(rgba(28,26,22,0) 50%, rgba(28,26,22,0.025) 50%);
  background-size: 100% 3px;
  color: ${INK};
  width: min(460px, 92vw);
  border: 2px solid ${INK};
  box-shadow: 6px 6px 0 ${HAIR};
  font-family: ${FONT_MONO};
  font-size: 13px;
  line-height: 1.55;
}

.otto-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
  background: ${PANEL};
  border-bottom: 1px solid ${HAIR};
  padding: 10px 16px;
}
.otto-modal-head .left { display: inline-flex; align-items: center; gap: 10px; }
.otto-modal-head img { width: 32px; height: 32px; image-rendering: pixelated; display: block; }
.otto-modal-head h3 {
  margin: 0;
  font-family: ${FONT_DISPLAY};
  font-size: 24px;
  font-weight: 400;
  line-height: 1;
  letter-spacing: .04em;
}
.otto-modal-head .state {
  font-family: ${FONT_MONO};
  font-size: 10px;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: ${PENCIL};
}

.otto-modal-body { padding: 16px 18px 18px; }
.otto-modal-sub {
  margin: 0 0 14px;
  font-size: 12px;
  color: ${PENCIL};
}
.otto-modal label {
  display: block;
  margin: 12px 0 6px;
  font-family: ${FONT_MONO};
  font-size: 10px;
  font-weight: 500;
  color: ${PENCIL};
  text-transform: uppercase;
  letter-spacing: .18em;
}
.otto-modal input,
.otto-modal textarea,
.otto-modal select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid ${HAIR};
  border-radius: 0;
  padding: 9px 10px;
  font-family: ${FONT_MONO};
  font-size: 13px;
  background: ${CREAM};
  color: ${INK};
  transition: border-color 120ms, box-shadow 120ms;
}
.otto-modal input:focus,
.otto-modal textarea:focus,
.otto-modal select:focus {
  outline: none;
  border-color: ${INK};
  box-shadow: 0 0 0 2px ${AMBER};
}
.otto-modal textarea { min-height: 96px; resize: vertical; }

.otto-row {
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed ${HAIR};
}
.otto-row button {
  border-radius: 0;
  border: 1px solid ${HAIR};
  padding: 9px 14px;
  font-family: ${FONT_MONO};
  font-size: 11px;
  font-weight: 500;
  letter-spacing: .18em;
  text-transform: uppercase;
  cursor: pointer;
  background: ${CREAM};
  color: ${INK};
  transition: all 120ms;
}
.otto-row button:hover { border-color: ${INK}; }
.otto-submit {
  background: ${INK} !important;
  color: ${CREAM} !important;
  border-color: ${INK} !important;
}
.otto-submit:hover { background: ${AMBER_DIM} !important; border-color: ${AMBER_DIM} !important; }
.otto-submit:disabled { opacity: .5; cursor: default; background: ${INK} !important; }

.otto-hint {
  font-family: ${FONT_MONO};
  font-size: 11px;
  color: ${PENCIL};
  margin-top: 6px;
  display: flex; align-items: flex-start; gap: 6px;
  padding: 6px 8px;
  border-left: 2px solid ${AMBER};
  background: ${CREAM};
}

.otto-toast {
  position: fixed; bottom: 20px; right: 20px;
  z-index: 2147483647;
  background: ${INK};
  color: ${CREAM};
  border: 1px solid ${INK};
  box-shadow: 4px 4px 0 ${HAIR};
  padding: 10px 14px;
  font-family: ${FONT_MONO};
  font-size: 12px;
  letter-spacing: .04em;
  display: inline-flex; align-items: center; gap: 8px;
}
.otto-toast img { width: 24px; height: 24px; image-rendering: pixelated; }
.otto-toast.is-error { background: ${RED}; border-color: ${RED}; }
.otto-toast.is-done  { color: ${CREAM}; }
.otto-toast.is-done strong { color: ${AMBER}; }

`.trim();

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── Floating action button ──────────────────────────────────────
  const fab = document.createElement("button");
  fab.className = "otto-fab";
  fab.setAttribute("aria-label", "tell otto");
  fab.innerHTML = `
    <span class="otto-face is-idle" data-otto-face>
      <img src="${OTTER_IDLE}" alt="" data-otto-sprite />
      <span class="otto-eye-bg l"></span>
      <span class="otto-eye-bg r"></span>
      <span class="otto-pupil l"></span>
      <span class="otto-pupil r"></span>
    </span>
    <span class="otto-fab-text">otto</span>
  `;
  fab.onclick = openModal;
  document.body.appendChild(fab);

  function setFabState(state: "idle" | "thinking" | "done" | "error") {
    const img = fab.querySelector("[data-otto-sprite]") as HTMLImageElement | null;
    const face = fab.querySelector("[data-otto-face]") as HTMLElement | null;
    if (img) img.src = SPRITE[state];
    if (face) face.className = `otto-face is-${state}`;
  }

  const SPRITE = {
    idle: OTTER_IDLE,
    thinking: OTTER_THINKING,
    done: OTTER_DONE,
    error: OTTER_ERROR,
  };

  // ── Modal ───────────────────────────────────────────────────────
  function openModal() {
    const overlay = document.createElement("div");
    overlay.className = "otto-overlay";
    overlay.innerHTML = `
      <div class="otto-modal" role="dialog" aria-modal="true" aria-labelledby="otto-title">
        <header class="otto-modal-head">
          <span class="left">
            <img src="${OTTER_IDLE}" alt="" data-otto-modal-sprite />
            <h3 id="otto-title">tell otto</h3>
          </span>
          <span class="state" data-otto-state>&gt; idle</span>
        </header>
        <div class="otto-modal-body">
          <p class="otto-modal-sub">otto drafts a pr from this. you review and merge — never auto-merge. otto figures out which repo from the page you&rsquo;re on.</p>
          <label for="otto-desc">what should change?</label>
          <textarea id="otto-desc" placeholder="the export button on this page fires even with zero rows selected."></textarea>
          <div class="otto-row">
            <button class="otto-cancel" type="button">cancel</button>
            <button class="otto-submit" type="button" disabled>send to otto</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") close();
    });
    overlay.querySelector(".otto-cancel")!.addEventListener("click", close);

    const submitBtn = overlay.querySelector(".otto-submit") as HTMLButtonElement;
    const textarea = overlay.querySelector("#otto-desc") as HTMLTextAreaElement;
    const stateLabel = overlay.querySelector("[data-otto-state]") as HTMLElement;
    const modalSprite = overlay.querySelector(
      "[data-otto-modal-sprite]",
    ) as HTMLImageElement;

    // Enable submit as soon as there's something to send.
    textarea.addEventListener("input", () => {
      submitBtn.disabled = !textarea.value.trim();
    });
    textarea.focus();

    const setModalState = (s: "idle" | "thinking" | "done" | "error") => {
      modalSprite.src = SPRITE[s];
      stateLabel.textContent = `> ${s}`;
      stateLabel.style.color =
        s === "done" ? GREEN : s === "error" ? RED : s === "thinking" ? AMBER_DIM : PENCIL;
    };

    submitBtn.addEventListener("click", async () => {
      const description = textarea.value.trim();
      if (!description) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "sending…";
      setModalState("thinking");
      setFabState("thinking");

      try {
        const res = await fetch(ENDPOINT!, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-otto-secret": SECRET!,
          },
          body: JSON.stringify({
            url: location.href,
            description,
            consoleErrors: consoleErrors.slice(),
            userAgent: navigator.userAgent,
            viewport: { w: innerWidth, h: innerHeight },
            at: Date.now(),
            projectId: PROJECT_ID,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
        setModalState("done");
        setFabState("done");
        toast("done", "otto's on it.", "draft pr coming shortly.");
        setTimeout(close, 600);
        setTimeout(() => setFabState("idle"), 4000);
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = "retry";
        setModalState("error");
        setFabState("error");
        toast("error", "couldn't reach otto.", (err as Error).message);
        setTimeout(() => setFabState("idle"), 3000);
      }
    });
  }

  // ── Toast ───────────────────────────────────────────────────────
  function toast(
    state: "done" | "error",
    headline: string,
    detail?: string,
  ) {
    const el = document.createElement("div");
    el.className = `otto-toast is-${state}`;
    el.innerHTML = `
      <img src="${SPRITE[state]}" alt="" />
      <span><strong>${escapeHtml(headline)}</strong>${
        detail ? ` <span style="opacity:.75">${escapeHtml(detail)}</span>` : ""
      }</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  function escapeHtml(s: string): string {
    return s.replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
          c
        ] as string),
    );
  }
})();
