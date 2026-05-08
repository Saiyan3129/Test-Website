/* kie-image-gen.js — self-contained image generation widget backed by kie.ai
 * Drops a floating button onto the page; opens a modal that calls
 * /api/kie/generate (server-proxied) and polls /api/kie/task for the result.
 * No external dependencies. Scoped via a ShadowRoot so host CSS can't leak in.
 */
(() => {
  if (window.__kieImageGenLoaded) return;
  window.__kieImageGenLoaded = true;

  const ENDPOINTS = {
    generate: "/api/kie/generate",
    task: "/api/kie/task",
    config: "/api/kie/config",
  };

  const MODELS = [
    { id: "google/nano-banana", label: "Nano Banana", note: "Gemini 2.5 Flash Image — fast, cheap" },
    { id: "google/nano-banana-pro", label: "Nano Banana Pro", note: "Higher quality, slower" },
    { id: "google/nano-banana-edit", label: "Nano Banana Edit", note: "Image-to-image edit" },
    { id: "black-forest-labs/flux-1.1-pro", label: "Flux 1.1 Pro", note: "Photorealism" },
    { id: "ideogram/v2", label: "Ideogram v2", note: "Strong text-in-image" },
  ];

  const RATIOS = ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4", "21:9", "auto"];

  // --- inject host: a fixed mount point on body, contents in shadow DOM ----
  const host = document.createElement("div");
  host.id = "kie-image-gen-host";
  host.style.cssText = "position:fixed;inset:auto 0 0 0;z-index:2147483600;pointer-events:none;";
  const root = host.attachShadow({ mode: "open" });

  root.innerHTML = `
    <style>
      :host, * { box-sizing: border-box; }
      .fab {
        position: fixed; right: 22px; bottom: 22px; pointer-events: auto;
        width: 56px; height: 56px; border-radius: 999px;
        background:
          radial-gradient(120% 120% at 30% 25%, #ffe39c 0%, #e7b85a 40%, #b18534 100%);
        border: 1px solid rgba(255,255,255,0.35);
        box-shadow:
          0 1px 0 rgba(255,255,255,0.4) inset,
          0 -10px 24px rgba(0,0,0,0.18) inset,
          0 12px 30px -8px rgba(177,133,52,0.55),
          0 4px 12px -2px rgba(0,0,0,0.25);
        cursor: pointer; display: grid; place-items: center; color: #2a1d05;
        transition: transform 240ms cubic-bezier(0.22,1,0.36,1), box-shadow 240ms cubic-bezier(0.22,1,0.36,1);
        outline: none;
      }
      .fab:hover { transform: translateY(-2px) scale(1.04); }
      .fab:active { transform: translateY(0) scale(0.97); }
      .fab:focus-visible {
        box-shadow:
          0 0 0 3px rgba(231,184,90,0.45),
          0 12px 30px -8px rgba(177,133,52,0.55);
      }
      .fab .pulse {
        position: absolute; inset: -6px; border-radius: 999px;
        border: 1px solid rgba(231,184,90,0.45);
        animation: pulse 2.4s ease-out infinite;
      }
      @keyframes pulse {
        0% { transform: scale(0.92); opacity: 0.55; }
        70% { transform: scale(1.18); opacity: 0; }
        100% { transform: scale(1.18); opacity: 0; }
      }
      .fab svg { width: 24px; height: 24px; }
      .fab .label {
        position: absolute; right: 64px; top: 50%; transform: translateY(-50%) translateX(6px);
        background: rgba(20,20,22,0.92); color: #f6f1e6;
        font: 500 11px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.14em; text-transform: uppercase;
        padding: 7px 10px; border-radius: 6px;
        opacity: 0; pointer-events: none;
        transition: opacity 200ms cubic-bezier(0.22,1,0.36,1), transform 200ms cubic-bezier(0.22,1,0.36,1);
        white-space: nowrap;
      }
      .fab:hover .label { opacity: 1; transform: translateY(-50%) translateX(0); }

      /* Modal */
      .scrim {
        position: fixed; inset: 0; pointer-events: auto;
        background: rgba(8,8,10,0.62);
        backdrop-filter: blur(8px) saturate(1.05);
        -webkit-backdrop-filter: blur(8px) saturate(1.05);
        opacity: 0; transition: opacity 220ms cubic-bezier(0.22,1,0.36,1);
        display: grid; place-items: center; padding: 24px;
      }
      .scrim.open { opacity: 1; }
      .panel {
        width: min(560px, 100%); max-height: calc(100vh - 48px);
        background:
          radial-gradient(120% 80% at 0% 0%, rgba(231,184,90,0.06), transparent 50%),
          radial-gradient(120% 80% at 100% 100%, rgba(231,184,90,0.04), transparent 55%),
          #0f0f12;
        color: #f5f1e6;
        border: 1px solid rgba(245,243,238,0.08);
        border-radius: 18px;
        box-shadow:
          0 1px 0 rgba(255,255,255,0.04) inset,
          0 30px 80px -20px rgba(0,0,0,0.8),
          0 0 0 1px rgba(231,184,90,0.05);
        overflow: hidden; display: flex; flex-direction: column;
        transform: translateY(8px) scale(0.985); opacity: 0;
        transition: transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 220ms cubic-bezier(0.22,1,0.36,1);
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .scrim.open .panel { transform: translateY(0) scale(1); opacity: 1; }

      .head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 18px 22px 14px; border-bottom: 1px solid rgba(245,243,238,0.06);
      }
      .head .title { display: flex; align-items: baseline; gap: 10px; }
      .head h2 {
        margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em;
      }
      .badge {
        font: 500 10px/1 ui-monospace, "JetBrains Mono", monospace;
        letter-spacing: 0.18em; text-transform: uppercase;
        color: #e7b85a; padding: 4px 7px; border: 1px solid rgba(231,184,90,0.35);
        border-radius: 999px; background: rgba(231,184,90,0.06);
      }
      .close {
        appearance: none; background: transparent; border: 0; color: #c8c2b4;
        width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
        display: grid; place-items: center;
        transition: background 160ms ease, color 160ms ease, transform 160ms ease;
      }
      .close:hover { background: rgba(245,243,238,0.06); color: #f5f1e6; }
      .close:active { transform: scale(0.94); }
      .close:focus-visible { outline: 2px solid rgba(231,184,90,0.5); outline-offset: 2px; }

      .body { padding: 18px 22px; overflow: auto; }
      .body > * + * { margin-top: 14px; }

      label.field {
        display: block; font: 500 11px/1.4 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.14em; text-transform: uppercase;
        color: #b6b1a4; margin-bottom: 6px;
      }
      textarea, select, input[type="text"] {
        width: 100%; background: #16161a;
        color: #f5f1e6; border: 1px solid rgba(245,243,238,0.10);
        border-radius: 10px; padding: 11px 12px;
        font: 400 14px/1.5 ui-sans-serif, system-ui, sans-serif;
        outline: none; resize: vertical;
        transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
      }
      textarea { min-height: 96px; }
      textarea::placeholder, input::placeholder { color: #6c6a66; }
      textarea:focus, select:focus, input:focus {
        border-color: rgba(231,184,90,0.55);
        box-shadow: 0 0 0 3px rgba(231,184,90,0.18);
        background: #1a1a1f;
      }
      select {
        appearance: none;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%23b6b1a4' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
        background-repeat: no-repeat; background-position: right 12px center;
        padding-right: 32px;
      }

      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip {
        appearance: none; cursor: pointer;
        font: 500 12px/1 ui-monospace, "JetBrains Mono", monospace;
        letter-spacing: 0.04em;
        background: #16161a; color: #c8c2b4;
        border: 1px solid rgba(245,243,238,0.10);
        border-radius: 999px; padding: 7px 12px;
        transition: background 160ms ease, color 160ms ease, border-color 160ms ease, transform 120ms ease;
      }
      .chip:hover { background: #1d1d23; color: #f5f1e6; }
      .chip:active { transform: scale(0.96); }
      .chip[aria-pressed="true"] {
        background: rgba(231,184,90,0.14); color: #ffeac4;
        border-color: rgba(231,184,90,0.55);
      }
      .chip:focus-visible { outline: 2px solid rgba(231,184,90,0.5); outline-offset: 2px; }

      .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

      .actions {
        display: flex; align-items: center; gap: 10px; justify-content: space-between;
        padding: 14px 22px 18px; border-top: 1px solid rgba(245,243,238,0.06);
        background: rgba(0,0,0,0.18);
      }
      .status {
        font: 500 11px/1.3 ui-monospace, "JetBrains Mono", monospace;
        letter-spacing: 0.08em; color: #8b8884; min-height: 14px;
      }
      .status .dot { display:inline-block; width:6px; height:6px; border-radius:999px; background:#6c6a66; margin-right:8px; vertical-align: middle; }
      .status.live .dot { background:#e7b85a; box-shadow: 0 0 8px rgba(231,184,90,0.7); animation: blink 1.2s ease-in-out infinite; }
      .status.err .dot { background:#ff5e57; }
      .status.ok  .dot { background:#7CD992; }
      @keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0.45 } }

      .btn {
        appearance: none; cursor: pointer; border: 0;
        font: 600 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.04em;
        padding: 12px 18px; border-radius: 10px;
        color: #2a1d05;
        background: linear-gradient(135deg, #ffe39c 0%, #e7b85a 50%, #b18534 100%);
        box-shadow:
          0 1px 0 rgba(255,255,255,0.4) inset,
          0 8px 22px -8px rgba(177,133,52,0.55);
        transition: transform 160ms cubic-bezier(0.22,1,0.36,1), box-shadow 160ms ease, opacity 160ms ease;
      }
      .btn:hover { transform: translateY(-1px); }
      .btn:active { transform: translateY(0) scale(0.985); }
      .btn:focus-visible { outline: 2px solid #ffeac4; outline-offset: 3px; }
      .btn[disabled] { opacity: 0.55; cursor: not-allowed; transform: none; }

      .btn-ghost {
        background: transparent; color: #c8c2b4;
        border: 1px solid rgba(245,243,238,0.12);
        box-shadow: none;
      }
      .btn-ghost:hover { background: rgba(245,243,238,0.05); color: #f5f1e6; }

      .result { margin-top: 6px; }
      .result-frame {
        position: relative; border-radius: 12px; overflow: hidden;
        border: 1px solid rgba(245,243,238,0.08);
        background:
          repeating-conic-gradient(#16161a 0% 25%, #1a1a1f 0% 50%) 0 0 / 18px 18px;
        aspect-ratio: 1 / 1; display: grid; place-items: center;
      }
      .result-frame img {
        width: 100%; height: 100%; object-fit: contain; display: block;
        opacity: 0; transform: scale(0.99);
        transition: opacity 360ms cubic-bezier(0.22,1,0.36,1), transform 360ms cubic-bezier(0.22,1,0.36,1);
      }
      .result-frame img.in { opacity: 1; transform: scale(1); }
      .result-meta {
        margin-top: 8px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
      }
      .url-pill {
        flex: 1 1 220px; min-width: 0;
        font: 400 11px/1.2 ui-monospace, "JetBrains Mono", monospace;
        background: #16161a; color: #c8c2b4;
        border: 1px solid rgba(245,243,238,0.10);
        border-radius: 8px; padding: 8px 10px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .err-msg {
        background: rgba(255,94,87,0.08); border: 1px solid rgba(255,94,87,0.28);
        color: #ffd6d3; border-radius: 10px; padding: 10px 12px;
        font: 500 12px/1.45 ui-sans-serif, system-ui, sans-serif;
      }

      .progress {
        height: 2px; width: 100%; overflow: hidden;
        background: rgba(245,243,238,0.06);
      }
      .progress > i {
        display: block; height: 100%; width: 30%;
        background: linear-gradient(90deg, transparent, #e7b85a, transparent);
        animation: slide 1.4s ease-in-out infinite;
      }
      @keyframes slide {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(400%); }
      }

      .hidden { display: none !important; }

      @media (max-width: 480px) {
        .fab { right: 14px; bottom: 14px; }
        .row2 { grid-template-columns: 1fr; }
      }
    </style>

    <button class="fab" type="button" aria-label="Generate image" title="Generate image">
      <span class="pulse" aria-hidden="true"></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" opacity="0.85"/>
      </svg>
      <span class="label">Generate</span>
    </button>

    <div class="scrim hidden" role="dialog" aria-modal="true" aria-label="AI image generator">
      <div class="panel" role="document">
        <div class="head">
          <div class="title">
            <h2>Image Studio</h2>
            <span class="badge">kie.ai</span>
          </div>
          <button class="close" type="button" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg>
          </button>
        </div>

        <div class="body">
          <div>
            <label class="field" for="kie-prompt">Prompt</label>
            <textarea id="kie-prompt" placeholder="A vintage leather loafer on a marble plinth, soft window light, editorial product photography…"></textarea>
          </div>

          <div class="row2">
            <div>
              <label class="field" for="kie-model">Model</label>
              <select id="kie-model"></select>
            </div>
            <div>
              <label class="field" for="kie-format">Format</label>
              <select id="kie-format">
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </div>
          </div>

          <div>
            <label class="field">Aspect ratio</label>
            <div class="chips" id="kie-ratios"></div>
          </div>

          <div class="result hidden" id="kie-result">
            <div class="result-frame" id="kie-frame">
              <img id="kie-img" alt="" />
            </div>
            <div class="result-meta">
              <div class="url-pill" id="kie-url" title=""></div>
              <button class="btn btn-ghost" type="button" id="kie-copy">Copy URL</button>
              <a class="btn btn-ghost" id="kie-open" target="_blank" rel="noopener">Open</a>
            </div>
          </div>

          <div class="err-msg hidden" id="kie-err"></div>
        </div>

        <div class="progress hidden" id="kie-progress"><i></i></div>

        <div class="actions">
          <div class="status" id="kie-status"><span class="dot"></span><span id="kie-status-text">Idle</span></div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost" type="button" id="kie-clear">Clear</button>
            <button class="btn" type="button" id="kie-go">Generate</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(host);

  // --- references ---------------------------------------------------------
  const $ = (sel) => root.querySelector(sel);
  const fab = $(".fab");
  const scrim = $(".scrim");
  const closeBtn = $(".close");
  const promptEl = $("#kie-prompt");
  const modelEl = $("#kie-model");
  const formatEl = $("#kie-format");
  const ratiosEl = $("#kie-ratios");
  const goBtn = $("#kie-go");
  const clearBtn = $("#kie-clear");
  const resultEl = $("#kie-result");
  const imgEl = $("#kie-img");
  const urlPill = $("#kie-url");
  const copyBtn = $("#kie-copy");
  const openLink = $("#kie-open");
  const errEl = $("#kie-err");
  const progressEl = $("#kie-progress");
  const statusEl = $("#kie-status");
  const statusText = $("#kie-status-text");

  // populate models
  for (const m of MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.label} — ${m.note}`;
    modelEl.appendChild(opt);
  }

  // ratio chips
  let activeRatio = "1:1";
  for (const r of RATIOS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = r;
    b.setAttribute("aria-pressed", r === activeRatio ? "true" : "false");
    b.addEventListener("click", () => {
      activeRatio = r;
      ratiosEl.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
    });
    ratiosEl.appendChild(b);
  }

  // pull server config to set default model + warn on missing key
  fetch(ENDPOINTS.config).then((r) => r.json()).then((cfg) => {
    if (cfg.defaultModel && [...modelEl.options].some((o) => o.value === cfg.defaultModel)) {
      modelEl.value = cfg.defaultModel;
    }
    if (!cfg.hasKey) setStatus("err", "KIE_API_KEY missing on server");
  }).catch(() => {});

  // --- state machine ------------------------------------------------------
  let polling = false;
  let pollAbort = null;

  function setStatus(kind, text) {
    statusEl.classList.remove("live", "err", "ok");
    if (kind) statusEl.classList.add(kind);
    statusText.textContent = text;
  }

  function showError(msg) {
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
    setStatus("err", "Error");
  }

  function clearError() {
    errEl.classList.add("hidden");
    errEl.textContent = "";
  }

  function clearResult() {
    resultEl.classList.add("hidden");
    imgEl.classList.remove("in");
    imgEl.removeAttribute("src");
    urlPill.textContent = "";
    urlPill.title = "";
    openLink.removeAttribute("href");
  }

  function setBusy(b) {
    goBtn.disabled = b;
    progressEl.classList.toggle("hidden", !b);
  }

  function openModal() {
    scrim.classList.remove("hidden");
    requestAnimationFrame(() => scrim.classList.add("open"));
    setTimeout(() => promptEl.focus(), 220);
  }
  function closeModal() {
    if (polling && pollAbort) { pollAbort.aborted = true; }
    scrim.classList.remove("open");
    setTimeout(() => scrim.classList.add("hidden"), 220);
  }

  fab.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  scrim.addEventListener("click", (e) => { if (e.target === scrim) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !scrim.classList.contains("hidden")) closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !scrim.classList.contains("hidden")) {
      e.preventDefault(); generate();
    }
  });

  clearBtn.addEventListener("click", () => {
    promptEl.value = "";
    clearResult();
    clearError();
    setStatus("", "Idle");
    promptEl.focus();
  });

  copyBtn.addEventListener("click", async () => {
    const u = urlPill.title;
    if (!u) return;
    try {
      await navigator.clipboard.writeText(u);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = original), 1200);
    } catch {
      setStatus("err", "Clipboard blocked");
    }
  });

  goBtn.addEventListener("click", generate);

  // --- generation flow ----------------------------------------------------
  async function generate() {
    clearError();
    clearResult();
    const prompt = promptEl.value.trim();
    if (!prompt) { showError("Enter a prompt first."); promptEl.focus(); return; }

    setBusy(true);
    setStatus("live", "Submitting…");
    let createRes;
    try {
      const r = await fetch(ENDPOINTS.generate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: modelEl.value,
          image_size: activeRatio,
          output_format: formatEl.value,
        }),
      });
      createRes = await r.json();
      if (!r.ok) throw new Error(createRes.error || createRes.msg || `HTTP ${r.status}`);
    } catch (e) {
      setBusy(false); showError(e.message || "Failed to start task"); return;
    }

    const taskId = createRes?.data?.taskId;
    if (!taskId) { setBusy(false); showError("No taskId returned: " + JSON.stringify(createRes)); return; }

    setStatus("live", `Generating… (${taskId.slice(0, 14)}…)`);
    pollAbort = { aborted: false };
    polling = true;

    const started = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;
    let delay = 1500;

    while (!pollAbort.aborted) {
      if (Date.now() - started > TIMEOUT_MS) {
        polling = false; setBusy(false);
        showError("Timed out after 5 minutes."); return;
      }
      await sleep(delay);
      if (pollAbort.aborted) return;
      let info;
      try {
        const r = await fetch(`${ENDPOINTS.task}?taskId=${encodeURIComponent(taskId)}`);
        info = await r.json();
      } catch (e) {
        // transient — keep polling
        continue;
      }
      const data = info?.data || {};
      const state = (data.state || "").toLowerCase();

      if (state === "success" || data.resultJson) {
        const urls = extractResultUrls(data.resultJson);
        if (urls.length) {
          polling = false; setBusy(false);
          showImage(urls[0]);
          setStatus("ok", `Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
          return;
        }
      }
      if (state === "fail" || state === "failed" || data.failCode) {
        polling = false; setBusy(false);
        showError(data.failMsg || `Generation failed (${data.failCode || "unknown"})`);
        return;
      }
      // still working — slow the poll a touch
      delay = Math.min(delay + 300, 3500);
    }
    polling = false; setBusy(false);
  }

  function extractResultUrls(resultJson) {
    if (!resultJson) return [];
    try {
      const parsed = typeof resultJson === "string" ? JSON.parse(resultJson) : resultJson;
      const u = parsed?.resultUrls || parsed?.result_urls || parsed?.urls || [];
      return Array.isArray(u) ? u.filter(Boolean) : [];
    } catch { return []; }
  }

  function showImage(url) {
    resultEl.classList.remove("hidden");
    urlPill.textContent = url;
    urlPill.title = url;
    openLink.href = url;
    imgEl.classList.remove("in");
    imgEl.onload = () => requestAnimationFrame(() => imgEl.classList.add("in"));
    imgEl.src = url;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
})();