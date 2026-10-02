/*
 * Testeria — content/overlay.js
 *
 * Semua UI Testeria di dalam halaman dirender lewat satu host ber-Shadow DOM
 * (mode open) supaya CSS halaman dan CSS Testeria tidak saling bentrok.
 * Host memakai `all: initial` dan pointer-events: none; elemen interaktif
 * mengaktifkan pointer-events secara lokal.
 *
 * Aman dievaluasi ulang (executeScript recovery): seluruh state UI di-reset,
 * host lama dihapus sebelum dibuat lagi.
 */
var overlay = (globalThis.TESTERIA_OVERLAY = globalThis.TESTERIA_OVERLAY || {});
(function () {
  "use strict";

  var api = globalThis.browser;
  var HOST_ID = "__testeria-host";

  var ui = {
    host: null,
    root: null,
    recDot: null,
    pill: null,
    modal: null,
    // Kursor virtual + ambient (mode replay)
    cursorHost: null,
    cursor: null,
    cursorLabel: null,
    ambient: null,
    ambientOn: false,
    cursorMode: "arrow", // "arrow" | "beam"
    cursorX: null,
    cursorY: null,
    quick: null,
    quickEscHandler: null
  };

  function ensureRoot() {
    var old = document.getElementById(HOST_ID);
    if (old) old.remove();
    var host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "all: initial; position: fixed; inset: auto; top: 0; right: 0; z-index: 2147483647; pointer-events: none;";
    (document.documentElement || document.body).appendChild(host);
    var root = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = CSS_TEXT;
    root.appendChild(style);
    // Cermin DOM (host attribute) dari mode kursor — dipakai E2E untuk
    // memverifikasi instant mode tanpa menyentuh state isolated world.
    try {
      host.setAttribute("data-tst-instant", instant ? "1" : "0");
    } catch (e) {}
    ui.host = host;
    ui.root = root;
    return root;
  }

  // ---------------------------------------------------------------------------
  // Kursor virtual (mode replay)
  // ---------------------------------------------------------------------------
  // Bukan panah polos: kelopak SVG gradien bergaya "AI" dengan orbit planet
  // kecil, plus ripple cincin di setiap aksi dan label step singkat.
  var CURSOR_SVG =
    '<svg viewBox="0 0 40 40" width="34" height="34" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<linearGradient id="tg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#7c4dff"/>' +
    '<stop offset="0.5" stop-color="#e91e8c"/>' +
    '<stop offset="1" stop-color="#ff9100"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<path d="M6 4 L32 17 L20.5 20.5 L17 32 Z" fill="url(#tg)" stroke="rgba(255,255,255,.9)" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<circle cx="9.5" cy="7.5" r="2.6" fill="#b388ff"/>' +
    '<circle cx="30.5" cy="6" r="1.8" fill="#ff9100"/>' +
    '</svg>';

  // I-beam teks dengan aksen gradien — muncul otomatis saat kursor berada di
  // atas field teks, lalu kembali panah saat meninggalkannya.
  var BEAM_SVG =
    '<svg viewBox="0 0 24 40" width="20" height="34" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#7c4dff"/>' +
    '<stop offset="1" stop-color="#e91e8c"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<rect x="10" y="7" width="3" height="26" rx="1.5" fill="url(#bg2)"/>' +
    '<rect x="5.5" y="4" width="12" height="3" rx="1.5" fill="url(#bg2)"/>' +
    '<rect x="5.5" y="33" width="12" height="3" rx="1.5" fill="url(#bg2)"/>' +
    '<rect x="6.5" y="5" width="10" height="1.2" rx="0.6" fill="rgba(255,255,255,.85)"/>' +
    '<rect x="6.5" y="34" width="10" height="1.2" rx="0.6" fill="rgba(255,255,255,.85)"/>' +
    '</svg>';

  var CURSOR_CSS = [
    ".tst-cursor-host { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }",
    ".tst-cursor { position: fixed; left: 0; top: 0; width: 34px; height: 34px;",
    "  pointer-events: none; will-change: transform; z-index: 2147483646;",
    "  filter: drop-shadow(0 2px 6px rgba(124,77,255,.45)); }",
    ".tst-cursor .art svg { display: block; transition: transform 150ms ease; }",
    ".tst-cursor .lbl { position: absolute; left: 26px; top: 22px; white-space: nowrap;",
    "  font: 500 10px/1.5 system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase;",
    "  background: rgba(20,20,28,.82); color: #efe6ff; border: 1px solid rgba(124,77,255,.5);",
    "  border-radius: 999px; padding: 1px 7px; opacity: 0; transition: opacity 160ms ease; }",
    ".tst-cursor.show-lbl .lbl { opacity: 1; }",
    ".tst-cursor .ring { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px;",
    "  border-radius: 50%; border: 2px solid #e91e8c; opacity: 0; transform: scale(.4); }",
    ".tst-cursor.click .ring { animation: tst-ring 480ms ease-out; }",
    "@keyframes tst-ring { 0% { opacity: .95; transform: scale(.5); } 100% { opacity: 0; transform: scale(3.2); } }",
    // ---- ambient bingkai tepian: dua cincin conic-gradient berputar berlawanan ----
    ".tst-ambient { position: fixed; inset: 0; pointer-events: none; z-index: 2147483645;",
    "  opacity: 0; transition: opacity 500ms ease; }",
    ".tst-ambient.on { opacity: 1; }",
    ".tst-ambient .frame { position: absolute; inset: -2px; }",
    ".tst-ambient .frame::before { content: ''; position: absolute; inset: 0; padding: 6px; border-radius: 10px;",
    "  background: conic-gradient(from var(--a,0deg), #7c4dff, #e91e8c, #ff9100, #00e5a0, #2979ff, #7c4dff);",
    "  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);",
    "  -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;",
    "  animation: tst-spin 9s linear infinite; }",
    ".tst-ambient .frame.b2::before { padding: 14px; opacity: .35; animation: tst-spin 15s linear infinite reverse; }",
    ".tst-ambient .frame.b3::before { padding: 22px; opacity: .22; animation: tst-spin 21s linear infinite; }",
    "@property --a { syntax: '<angle>'; inherits: false; initial-value: 0deg; }",
    "@keyframes tst-spin { to { --a: 360deg; } }",
    // Fallback browser tanpa @property: hue-rotate pada gradient statis + blur
    // tipis agar tepi bingkai terasa smooth.
    ".tst-ambient .frame::before { filter: hue-rotate(0deg) blur(3px); animation: tst-spin 9s linear infinite, tst-hue 4.5s linear infinite; }",
    ".tst-ambient .frame.b2::before { animation: tst-spin 15s linear infinite reverse, tst-hue 7s linear infinite reverse; }",
    ".tst-ambient .frame.b3::before { animation: tst-spin 21s linear infinite, tst-hue 9.5s linear infinite; }",
    "@keyframes tst-hue { to { filter: hue-rotate(360deg) blur(3px); } }",
    "@media (prefers-reduced-motion: reduce) {",
    "  .tst-ambient .frame::before { animation: none; }",
    "  .tst-ambient .frame.b2::before { animation: none; }",
    "  .tst-ambient .frame.b3::before { animation: none; }",
    "}", ,
    ""
  ].join("\n");

  function ensureCursorLayer() {
    if (ui.cursorHost && ui.cursorHost.isConnected) return ui.root;
    ensureRoot();
    // PENTING: inject CURSOR_CSS ke shadow root — ensureRoot hanya menyuntik
    // CSS dasar (pill/modal). Tanpa ini ambient tak berukuran/warna dan
    // kursor tak punya position:fixed (cacat yang membuat fitur tak terlihat).
    var cursorStyle = document.createElement("style");
    cursorStyle.textContent = CURSOR_CSS;
    ui.root.appendChild(cursorStyle);

    var host = document.createElement("div");
    host.className = "tst-cursor-host";
    ui.root.appendChild(host);
    ui.cursorHost = host;

    // Ambient: dua cincin gradient berputar di TEPi viewport (bukan bloom).
    var amb = document.createElement("div");
    amb.className = "tst-ambient";
    amb.innerHTML =
      '<div class="frame"></div><div class="frame b2"></div><div class="frame b3"></div>';
    host.appendChild(amb);
    ui.ambient = amb;

    var cur = document.createElement("div");
    cur.className = "tst-cursor";
    cur.innerHTML =
      '<div class="art" style="width:34px;height:34px">' + CURSOR_SVG + "</div>" +
      '<div class="ring"></div>' +
      '<div class="lbl"></div>';
    host.appendChild(cur);
    ui.cursor = cur;
    ui.cursorLabel = cur.lastChild; // .lbl
    ui.cursorX = null; // posisi logis kursor (px viewport)
    ui.cursorY = null;
    return ui.root;
  }

  function setCursorArt(mode) {
    if (ui.cursorMode === mode || !ui.cursor) return;
    ui.cursorMode = mode;
    var art = ui.cursor.firstChild;
    if (!art) return;
    art.innerHTML = mode === "beam" ? BEAM_SVG : CURSOR_SVG;
    art.style.width = mode === "beam" ? "20px" : "34px";
    art.style.height = mode === "beam" ? "34px" : "34px";
  }

  /** Cek apakah elemen di bawah titik adalah field teks (→ mode I-beam). */
  function isTextInputAt(x, y) {
    var el = null;
    try {
      el = document.elementFromPoint(x, y);
    } catch (e) {
      return false;
    }
    var n = el;
    var depth = 0;
    while (n && n.nodeType === 1 && depth < 4) {
      var tag = n.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "INPUT") {
        var t = (n.getAttribute("type") || "text").toLowerCase();
        if (t !== "checkbox" && t !== "radio" && t !== "button" && t !== "submit" && t !== "reset" && t !== "range") {
          return true;
        }
        return false;
      }
      if (n.isContentEditable) return true;
      n = n.parentElement;
      depth++;
    }
    return false;
  }

  /** Gerakan halus dari (x0,y0) ke (x1,y1): ease-in-out penuh, TANPA jejak yang
   * menyebabkan kedip. Gerakan terasa seperti manusia — bukan penyisipan linear
   * kaku antar titik jejak. */
  function glide(from, to, duration, onFrame, onDone) {
    var start = null;
    function frame(ts) {
      if (start == null) start = ts;
      var t = Math.min(1, (ts - start) / duration);
      var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      onFrame(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        onDone();
      }
    }
    requestAnimationFrame(frame);
  }

  /**
   * Gerakkan kursor virtual ke (x,y) dengan glide halus ease-in-out —
   * gerakan langsung from→to, TANPA rekonstruksi jejak mouse terekam
   * (dulu menyebabkan lompatan/blink; ditemukan via E2E).
   * Instant mode (settings.replayInstant): kursor pindah tanpa animasi.
   * Resolve saat kursor tiba.
   */
  overlay.vcMoveTo = function (x, y, label) {
    if (!ui.cursorHost || !ui.cursorHost.isConnected || !ui.cursor) {
      return Promise.resolve(false);
    }
    var beam = isTextInputAt(x, y);
    setCursorArt(beam ? "beam" : "arrow");
    if (ui.cursorLabel) {
      ui.cursorLabel.textContent = label ? "Testeria: " + label : "";
    }
    if (label) ui.cursor.classList.add("show-lbl");
    else ui.cursor.classList.remove("show-lbl");

    var fromX = ui.cursorX == null ? x : ui.cursorX;
    var fromY = ui.cursorY == null ? y : ui.cursorY;
    var dist = Math.abs(x - fromX) + Math.abs(y - fromY);

    if (overlay.instantMode()) {
      ui.cursorX = x;
      ui.cursorY = y;
      ui.cursor.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
      return Promise.resolve(true);
    }

    var duration = Math.max(180, Math.min(900, dist / 1.6));
    return new Promise(function (resolve) {
      if (dist < 1) {
        ui.cursorX = x;
        ui.cursorY = y;
        ui.cursor.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
        resolve(true);
        return;
      }
      glide(
        [fromX, fromY],
        [x, y],
        duration,
        function (px, py) {
          ui.cursorX = px;
          ui.cursorY = py;
          ui.cursor.style.transform = "translate(" + Math.round(px) + "px," + Math.round(py) + "px)";
        },
        function () {
          ui.cursorX = x;
          ui.cursorY = y;
          ui.cursor.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
          resolve(true);
        }
      );
    });
  };

  /** Instant mode (settings.replayInstant) — cache di modul; di-set main.js. */
  var instant = false;
  overlay.setInstantMode = function (v) {
    instant = !!v;
    try {
      if (ui.host) ui.host.setAttribute("data-tst-instant", instant ? "1" : "0");
    } catch (e) {}
  };
  overlay.instantMode = function () { return instant; };

  /** Efek ripple di posisi kursor (panggil saat aksi dieksekusi). */
  overlay.vcClick = function () {
    if (!ui.cursor) return;
    ui.cursor.classList.remove("click");
    void ui.cursor.offsetWidth; // restart animasi
    ui.cursor.classList.add("click");
  };

  /** Ambient rainbow ala "AI mengambil alih browser". */
  overlay.ambientStart = function () {
    ensureCursorLayer();
    if (ui.ambient) ui.ambient.classList.add("on");
    ui.ambientOn = true;
  };

  overlay.ambientStop = function () {
    if (ui.ambient) ui.ambient.classList.remove("on");
    ui.ambientOn = false;
  };

  overlay.ambientIsActive = function () {
    return ui.ambientOn;
  };

  overlay.cursorStart = function () {
    ensureCursorLayer();
  };

  overlay.cursorStop = function () {
    if (ui.cursorHost) {
      ui.cursorHost.remove();
      ui.cursorHost = null;
      ui.cursor = null;
      ui.cursorLabel = null;
      ui.ambient = null;
      ui.cursorX = null;
      ui.cursorY = null;
      ui.cursorMode = "arrow";
    }
  };

  var CSS_TEXT = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }",
    // ---- REC dot ----
    ".rec-dot { position: fixed; top: 10px; right: 10px; width: 12px; height: 12px;",
    "  border-radius: 50%; background: #d93025; box-shadow: 0 0 0 2px rgba(217,48,37,.25);",
    "  animation: testeria-pulse 1.2s ease-in-out infinite; }",
    "@keyframes testeria-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }",
    // ---- pill (progress / failure) ----
    ".pill { position: fixed; bottom: 14px; right: 14px; pointer-events: auto;",
    "  background: #202124; color: #fff; padding: 8px 12px; border-radius: 8px;",
    "  font-size: 12px; line-height: 1.4; max-width: 420px; box-shadow: 0 2px 10px rgba(0,0,0,.35); }",
    ".pill .row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }",
    ".pill button { pointer-events: auto; border: 1px solid #5f6368; background: transparent;",
    "  color: #fff; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }",
    ".pill button.primary { background: #8ab4f8; border-color: #8ab4f8; color: #202124; }",
    // ---- modal ----
    ".backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); pointer-events: auto;",
    "  display: flex; align-items: center; justify-content: center; }",
    ".card { background: #fff; color: #202124; border-radius: 10px; padding: 18px;",
    "  width: min(420px, calc(100vw - 40px)); box-shadow: 0 8px 30px rgba(0,0,0,.35); }",
    ".card h2 { margin: 0 0 4px; font-size: 15px; }",
    ".card p { margin: 0 0 12px; font-size: 12px; color: #5f6368; }",
    ".card input { width: 100%; padding: 8px 10px; font-size: 14px; border: 1px solid #dadce0;",
    "  border-radius: 6px; outline: none; }",
    ".card input:focus { border-color: #1a73e8; }",
    ".actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }",
    ".actions button { padding: 7px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; border: 1px solid transparent; }",
    ".btn-secondary { background: #fff; border-color: #dadce0 !important; color: #202124; }",
    ".btn-primary { background: #1a73e8; color: #fff; }",
    ".btn-primary:disabled { background: #bdc1c6; cursor: not-allowed; }",
    // ---- Panel replay (progress + daftar task) ----
    ".tst-panel { position: fixed; bottom: 14px; right: 14px; pointer-events: auto;",
    "  width: 300px; max-height: min(70vh, 520px); display: flex; flex-direction: column;",
    "  background: rgba(18,18,26,.96); color: #efeafe; border-radius: 14px;",
    "  border: 1px solid rgba(124,77,255,.45); box-shadow: 0 18px 60px rgba(0,0,0,.5); overflow: hidden; }",
    ".tst-panel.failed { border-color: rgba(242,139,130,.55); }",
    ".tst-panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 6px; }",
    ".tst-panel-title { font: 600 12px/1.4 system-ui, sans-serif; letter-spacing: .02em;",
    "  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".tst-panel-x { background: transparent; border: none; color: #b9a8e8; font-size: 16px; cursor: pointer; padding: 0 4px; }",
    ".tst-panel-status { padding: 0 12px; font: 600 12.5px/1.5 system-ui, sans-serif; color: #c9b8ff; }",
    ".tst-panel-status.err { color: #f28b82; }",
    ".tst-panel-hint { padding: 4px 12px 0; font: 400 11px/1.5 system-ui, sans-serif; color: #a99bd1; }",
    ".tst-panel-err { margin: 6px 12px 0; padding: 7px 9px; border-radius: 8px; background: rgba(242,139,130,.12);",
    "  font: 400 11px/1.5 system-ui, sans-serif; color: #f6aea6; max-height: 88px; overflow-y: auto; }",
    ".tst-panel-list { margin-top: 8px; overflow-y: auto; padding: 2px 8px 8px; }",
    ".tst-step-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;",
    "  background: transparent; border: none; border-radius: 8px; padding: 5px 8px; margin: 1px 0;",
    "  color: #cfc4f2; cursor: pointer; font: 400 11.5px/1.4 system-ui, sans-serif; }",
    ".tst-step-item:hover { background: rgba(124,77,255,.18); }",
    ".tst-step-item.current { background: rgba(124,77,255,.3); color: #fff; }",
    ".tst-step-item.done { opacity: .55; }",
    ".tst-step-item.failed { background: rgba(242,139,130,.18); color: #f6aea6; }",
    ".tst-step-item.assert .tst-step-num { background: rgba(0,229,160,.35); color: #d6fff2; border-radius: 4px; }",
    ".tst-step-item.assert.current .tst-step-num { background: #00e5a0; color: #06281e; }",
    ".tst-step-num { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; display: inline-flex;",
    "  align-items: center; justify-content: center; font: 600 9.5px/1 system-ui, sans-serif;",
    "  background: rgba(124,77,255,.35); color: #e6dcff; }",
    ".tst-step-item.current .tst-step-num { background: #7c4dff; color: #fff; }",
    ".tst-step-item.failed .tst-step-num { background: #f28b82; color: #201a1a; }",
    ".tst-step-item.page .tst-step-num { background: rgba(41,121,255,.35); color: #dbe8ff; }",
    ".tst-step-item.page.current .tst-step-num { background: #2979ff; color: #fff; }",
    ".tst-step-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".tst-step-text { min-width: 0; display: flex; flex-direction: column; gap: 1px; }",
    ".tst-step-sub { font: 400 9.5px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;",
    "  color: #8d7fb8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".tst-panel-actions { display: flex; gap: 6px; padding: 8px 12px 12px; border-top: 1px solid rgba(124,77,255,.25); }",
    ".tst-panel-actions button { flex: 1; border: 1px solid #5f6368; background: transparent; color: #efeafe;",
    "  border-radius: 7px; padding: 6px 4px; font: 500 11.5px/1.2 system-ui, sans-serif; cursor: pointer; }",
    ".tst-panel-actions button.primary { background: #7c4dff; border-color: #7c4dff; color: #fff; }",
    ".tst-panel-actions button:hover { background: rgba(124,77,255,.25); }",
    ".tst-panel-actions button.primary:hover { background: #8d5cff; }",
    // ---- Quick menu (F9): launcher replay di tengah layar ----
    ".tst-quick-backdrop { position: fixed; inset: 0; background: rgba(10,10,16,.45);",
    "  pointer-events: auto; display: flex; align-items: center; justify-content: center; }",
    ".tst-quick { width: min(430px, calc(100vw - 48px)); max-height: min(70vh, 560px);",
    "  display: flex; flex-direction: column; background: rgba(18,18,26,.96); color: #efeafe;",
    "  border-radius: 14px; border: 1px solid rgba(124,77,255,.45);",
    "  box-shadow: 0 18px 60px rgba(0,0,0,.5); overflow: hidden; }",
    ".tst-quick-head { display: flex; align-items: center; justify-content: space-between;",
    "  padding: 12px 14px; border-bottom: 1px solid rgba(124,77,255,.25); }",
    ".tst-quick-title { font: 600 13px/1.4 system-ui, sans-serif; letter-spacing: .02em; }",
    ".tst-quick-x { background: transparent; border: none; color: #b9a8e8; font-size: 18px;",
    "  cursor: pointer; padding: 0 4px; }",
    ".tst-quick-status { padding: 8px 14px 0; font: 500 11px/1.5 system-ui, sans-serif; color: #ffb3c7; }",
    ".tst-quick-list { overflow-y: auto; padding: 6px; }",
    ".tst-quick-item { display: flex; align-items: center; justify-content: space-between; gap: 10px;",
    "  width: 100%; background: transparent; border: none; border-radius: 9px; padding: 9px 10px;",
    "  cursor: pointer; text-align: left; color: inherit; }",
    ".tst-quick-item:hover { background: rgba(124,77,255,.18); }",
    ".tst-quick-group { padding: 9px 10px 3px; font: 600 10.5px/1.4 system-ui, sans-serif;",
    "  letter-spacing: .07em; text-transform: uppercase; color: #8d7fb8; }",
    ".tst-quick-indent { margin-left: 12px; }",
    ".tst-quick-name { font: 500 13px/1.4 system-ui, sans-serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".tst-quick-meta { font: 400 10.5px/1.4 system-ui, sans-serif; color: #a99bd1; flex-shrink: 0; }",
    ".tst-quick-empty { padding: 18px 14px; font: 400 12px/1.6 system-ui, sans-serif; color: #a99bd1; }",
    ".tst-quick-set { display: flex; align-items: center; gap: 8px; padding: 8px 14px 0;",
    "  font: 400 10.5px/1.4 system-ui, sans-serif; color: #8d7fb8; }",
    ".tst-quick-toggle { border: 1px solid rgba(124,77,255,.5); background: rgba(124,77,255,.16);",
    "  color: #e6dcff; border-radius: 999px; padding: 5px 10px; cursor: pointer;",
    "  font: 500 11px/1.2 system-ui, sans-serif; }",
    ".tst-quick-toggle:hover { background: rgba(124,77,255,.3); }",
    ".tst-quick-foot { padding: 8px 14px; border-top: 1px solid rgba(124,77,255,.25);",
    "  margin-top: 8px; font: 400 10.5px/1.4 system-ui, sans-serif; color: #8d7fb8; }",
    // ---- Panel dikecilkan: pill status klik-untuk-buka ----
    ".tst-minipill { position: fixed; bottom: 14px; right: 14px; pointer-events: auto;",
    "  background: rgba(18,18,26,.96); color: #efeafe; border: 1px solid rgba(124,77,255,.45);",
    "  border-radius: 999px; padding: 6px 14px; font: 500 11.5px/1.4 system-ui, sans-serif;",
    "  cursor: pointer; box-shadow: 0 10px 30px rgba(0,0,0,.45); }",
    ".tst-minipill:hover { background: rgba(124,77,255,.3); }",
    // ---- Notice kuning (mis. guard reload di tengah step) ----
    ".tst-panel-notice { margin: 6px 12px 0; padding: 7px 9px; border-radius: 8px;",
    "  background: rgba(251,188,5,.12); font: 400 11px/1.5 system-ui, sans-serif;",
    "  color: #fdd663; max-height: 110px; overflow-y: auto; }"
  ].join("\n");

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "style") node.style.cssText = attrs[k];
        else if (k === "class") node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------------------------------------------------------------------------
  // REC dot
  // ---------------------------------------------------------------------------
  overlay.showRecDot = function () {
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
    if (ui.recDot) return;
    ui.recDot = el("div", { class: "rec-dot", title: "Testeria sedang merekam" });
    root.appendChild(ui.recDot);
  };

  overlay.hideRecDot = function () {
    if (ui.recDot) {
      ui.recDot.remove();
      ui.recDot = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Modal Save/Discard (muncul saat recording di-stop)
  // ---------------------------------------------------------------------------
  overlay.showSaveModal = function (steps, startUrl) {
    overlay.closeModal();
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();

    var backdrop = el("div", { class: "backdrop" });
    var card = el("div", { class: "card" });
    card.appendChild(el("h2", null, "Testeria — simpan recording"));
    card.appendChild(
      el("p", null, (steps ? steps.length : 0) + " step terekam. Beri nama untuk menyimpan.")
    );
    var input = el("input", {
      type: "text",
      placeholder: "Nama recording, mis. login-flow",
      autofocus: ""
    });
    card.appendChild(input);

    var actions = el("div", { class: "actions" });
    var discardBtn = el("button", { class: "btn-secondary" }, "Discard");
    var saveBtn = el("button", { class: "btn-primary" }, "Save");
    saveBtn.disabled = true;
    input.addEventListener("input", function () {
      saveBtn.disabled = input.value.trim().length === 0;
    });
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter" && input.value.trim()) saveBtn.click();
    });
    saveBtn.addEventListener("click", function () {
      var name = input.value.trim();
      if (!name) return; // nama kosong tidak boleh disimpan
      saveBtn.disabled = true;
      api.runtime
        .sendMessage({ type: "TESTERIA_SAVE_RECORDING", name: name, steps: steps || [], startUrl: startUrl || null })
        .catch(function () { })
        .finally(function () {
          overlay.closeModal();
        });
    });
    discardBtn.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_DISCARD_RECORDING" }).catch(function () { });
      overlay.closeModal();
    });
    actions.appendChild(discardBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    root.appendChild(backdrop);
    ui.modal = backdrop;
    setTimeout(function () {
      try {
        input.focus();
      } catch (e) { }
    }, 50);
  };

  overlay.closeModal = function () {
    if (ui.modal) {
      ui.modal.remove();
      ui.modal = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Replay: panel progress + daftar task (klik untuk mulai dari step itu)
  // ---------------------------------------------------------------------------
  var panelDom = null; // { el, statusEl, noticeEl, errEl, hintEl, listEl, actionsEl, items: [], actionsSig }
  var panelOpts = null; // opts terakhir (labels dipakai ulang antar render)
  var panelMinimized = false; // × = kecilkan ke pill (replay JALAN TERUS), bukan stop
  var pillDom = null; // { el } — pill status saat panel dikecilkan
  // Handler panel SELALU dibaca dari variabel modul ini — bukan dari closure
  // saat tombol dibuat. Panel bisa dibangun oleh showReplayProgress (fallback
  // tanpa handler) SEBELUM render ber-state datang; kalau listener menangkap
  // closure lama, tombol klikannya mati (ditemukan saat playtest: Pause tidak
  // berfungsi karena closures kosong dari build pertama).
  var panelHandlers = { onJump: null, onAction: null };

  function panelStatusText(o) {
    return {
      running: "Step " + ((o.current || 0) + 1) + "/" + o.total,
      "waiting-password": "Menunggu password — step " + ((o.current || 0) + 1) + "/" + o.total,
      paused: "DIJEDA — step " + ((o.current || 0) + 1) + "/" + o.total,
      failed: "GAGAL di step " + ((o.failedStep != null ? o.failedStep : o.current || 0) + 1) + "/" + o.total,
      loading: "Menyiapkan halaman…",
      done: "Selesai ✓ " + o.total + " step"
    }[o.status] || "";
  }

  // [label, action, primary] — action selalu slot 1 (dulu Stop ditulis
  // ["Stop", <primary>] → handler menerima `true`/`false` sebagai aksi dan
  // tidak mengirim apa pun; ditemukan saat playtest: tombol Stop mati).
  function panelButtonsFor(status) {
    if (status === "running" || status === "waiting-password") {
      return [["Pause", "pause"], ["Skip", "skip"], ["Stop", "stop", true]];
    }
    if (status === "paused") {
      return [["Lanjutkan", "resume", true], ["Skip", "skip"], ["Stop", "stop"]];
    }
    if (status === "failed") {
      return [["Ulangi step", "retry", true], ["Skip", "skip"], ["Stop", "stop"]];
    }
    if (status === "loading") return [["Stop", "stop", true]];
    return []; // done
  }

  /** Kelas tambahan per jenis step (badge jenis di daftar). */
  function stepClass(type) {
    if (type === "assert") return " assert";
    if (type === "pageload" || type === "navigate") return " page";
    return "";
  }

  /** Teks pill status saat panel dikecilkan (×). */
  function pillTextFor(o) {
    var n = (o.current || 0) + 1;
    if (o.status === "failed") {
      return "⚡ Gagal di step " + ((o.failedStep != null ? o.failedStep : o.current || 0) + 1) + "/" + o.total;
    }
    if (o.status === "done") return "⚡ Selesai ✓ " + o.total + " step";
    if (o.status === "loading") return "⚡ Menyiapkan halaman…";
    if (o.status === "paused") return "⚡ Dijeda — step " + n + "/" + o.total;
    if (o.status === "waiting-password") return "⚡ Password — step " + n + "/" + o.total;
    return "⚡ Step " + n + "/" + o.total;
  }

  /** Kecilkan panel: ganti dengan pill status kecil di pojok. Replay jalan terus. */
  function renderReplayPill() {
    var o = panelOpts;
    if (!o) return;
    if (panelDom && panelDom.el && panelDom.el.isConnected) panelDom.el.remove();
    panelDom = null; // restore rebuild panel penuh dari panelOpts
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
    if (!pillDom || !pillDom.el || !pillDom.el.isConnected) {
      var b = el("button", { class: "tst-minipill", title: "Tampilkan panel replay" });
      b.addEventListener("click", function () {
        panelMinimized = false;
        if (pillDom) { pillDom.el.remove(); pillDom = null; }
        if (panelOpts) overlay.updateReplayPanel(panelOpts);
      });
      root.appendChild(b);
      pillDom = { el: b };
    }
    pillDom.el.textContent = pillTextFor(o);
    ui.pill = pillDom.el;
  }

  /**
   * Panel replay: dibangun SEKALI per replay (atau saat jumlah step berubah),
   * lalu di-UPDATE IN PLACE — full re-render tiap step membuat tombol lepas
   * dari DOM sehingga klik user sering kena "element detached" (ditemukan saat
   * playtest: Pause tak bisa diklik karena panel terus dibangun ulang).
   * opts: { name, status, current, total, labels[], types[], error, failedStep, notice,
   *         onJump(n), onAction("pause"|"resume"|"skip"|"stop"|"retry") }
   */
  overlay.showReplayPanel = function (opts) {
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();

    panelHandlers.onJump = typeof opts.onJump === "function" ? opts.onJump : panelHandlers.onJump;
    panelHandlers.onAction =
      typeof opts.onAction === "function" ? opts.onAction : panelHandlers.onAction;
    panelOpts = opts;

    // Dikecilkan user (×): jangan bangun ulang panel — cukup perbarui pill.
    if (panelMinimized) {
      renderReplayPill();
      return;
    }

    // (Re)build: panel belum ada, ATAU daftar step berubah jumlahnya
    // (replay baru / reload / build pertama tanpa labels).
    if (
      !panelDom ||
      !panelDom.el.isConnected ||
      (opts.labels && opts.labels.length !== panelDom.items.length)
    ) {
      if (panelDom && panelDom.el.isConnected) panelDom.el.remove();
      var panel = el("div", { class: "tst-panel" });
      var head = el("div", { class: "tst-panel-head" });
      head.appendChild(el("span", { class: "tst-panel-title" }, "⚡ Testeria replay" + (opts.name ? " — " + opts.name : "")));
      var close = el("button", { class: "tst-panel-x", title: "Kecilkan panel (replay tetap jalan)" }, "×");
      close.addEventListener("click", function () {
        panelMinimized = true;
        renderReplayPill();
      });
      head.appendChild(close);
      panel.appendChild(head);

      var statusEl = el("div", { class: "tst-panel-status" });
      panel.appendChild(statusEl);
      var hintEl = el("div", { class: "tst-panel-hint", style: "display:none" });
      panel.appendChild(hintEl);
      var noticeEl = el("div", { class: "tst-panel-notice", style: "display:none" });
      panel.appendChild(noticeEl);
      var errEl = el("div", { class: "tst-panel-err", style: "display:none" });
      panel.appendChild(errEl);

      var listEl = el("div", { class: "tst-panel-list" });
      var items = [];
      if (opts.labels && opts.labels.length) {
        for (var i = 0; i < opts.labels.length; i++) {
          (function (idx) {
            var b = el("button", {
              class: "tst-step-item" + stepClass(opts.types && opts.types[idx])
            });
            b.appendChild(el("span", { class: "tst-step-num" }, String(idx + 1)));
            var text = el("span", { class: "tst-step-text" });
            text.appendChild(el("span", { class: "tst-step-label" }, opts.labels[idx] || "step " + (idx + 1)));
            var hint = (opts.hints && opts.hints[idx]) || "";
            if (hint) text.appendChild(el("span", { class: "tst-step-sub" }, hint));
            b.appendChild(text);
            b.title = (opts.labels[idx] || "") + (hint ? "\n" + hint : "");
            b.addEventListener("click", function () {
              if (typeof panelHandlers.onJump === "function") panelHandlers.onJump(idx + 1); // 1-based
            });
            listEl.appendChild(b);
            items.push(b);
          })(i);
        }
      }
      panel.appendChild(listEl);

      var actionsEl = el("div", { class: "tst-panel-actions" });
      panel.appendChild(actionsEl);

      ui.pill = panel;
      root.appendChild(panel);
      panelDom = { el: panel, statusEl: statusEl, noticeEl: noticeEl, hintEl: hintEl, errEl: errEl, listEl: listEl, actionsEl: actionsEl, items: items };
    }

    var d = panelDom;
    var failed = opts.status === "failed";
    d.el.className = "tst-panel" + (failed ? " failed" : "");
    d.statusEl.textContent = panelStatusText(opts);
    d.statusEl.className = "tst-panel-status" + (failed ? " err" : "");
    if (opts.status === "paused") {
      d.hintEl.textContent = "Halaman bebas Anda utak-atik, lalu lanjutkan. Klik step mana pun di daftar untuk mulai dari sana.";
      d.hintEl.style.display = "";
    } else {
      d.hintEl.style.display = "none";
    }
    if (opts.error) {
      d.errEl.textContent = opts.error;
      d.errEl.style.display = "";
    } else {
      d.errEl.style.display = "none";
    }
    if (opts.notice) {
      d.noticeEl.textContent = opts.notice;
      d.noticeEl.style.display = "";
    } else {
      d.noticeEl.style.display = "none";
    }

    // Kelas step: current / failed / done — cukup swap className, DOM tetap.
    for (var k = 0; k < d.items.length; k++) {
      var cls = "tst-step-item" + stepClass(opts.types && opts.types[k]);
      if (opts.current === k) cls += " current";
      else if (opts.failedStep === k) cls += " failed";
      else if (opts.current != null && k < opts.current) cls += " done";
      d.items[k].className = cls;
      // Label bisa ter-upgrade saat step dieksekusi (rekaman lama tanpa nama:
      // background mengisi nama manusiawi dari elemen hidup) — update in-place.
      if (opts.labels && typeof opts.labels[k] === "string") {
        var lbl = d.items[k].querySelector(".tst-step-label");
        if (lbl && lbl.textContent !== opts.labels[k]) lbl.textContent = opts.labels[k];
      }
    }
    var mark = d.listEl.querySelector(".current, .failed");
    if (mark && mark.scrollIntoView) {
      try { mark.scrollIntoView({ block: "nearest" }); } catch (e) {}
    }

    // Tombol aksi: rebuild HANYA saat set-nya berubah (status berganti).
    var wanted = panelButtonsFor(opts.status);
    var sig = JSON.stringify(wanted);
    if (d.actionsSig !== sig) {
      d.actionsEl.textContent = "";
      for (var a = 0; a < wanted.length; a++) {
        (function (w) {
          var b = el("button", { class: w[2] ? "primary" : null }, w[0]);
          b.addEventListener("click", function () {
            if (typeof panelHandlers.onAction === "function") panelHandlers.onAction(w[1]);
          });
          d.actionsEl.appendChild(b);
        })(wanted[a]);
      }
      d.actionsSig = sig;
    }
    if (opts.status === "done") {
      setTimeout(function () {
        if (ui.pill === d.el) overlay.hideReplay();
      }, 4000);
    }
  };

  overlay.updateReplayPanel = function (opts) {
    opts.labels = opts.labels || (panelOpts && panelOpts.labels);
    opts.hints = opts.hints || (panelOpts && panelOpts.hints);
    overlay.showReplayPanel(opts);
  };

  overlay.showReplayProgress = function (stepNumber, total) {
    overlay.updateReplayPanel({
      status: "running",
      current: stepNumber - 1,
      total: total || 0,
      error: null,
      failedStep: null
    });
  };

  overlay.hideReplay = function () {
    if (ui.pill) {
      ui.pill.remove();
      ui.pill = null;
    }
    panelDom = null;
    panelOpts = null;
    panelHandlers.onJump = null;
    panelHandlers.onAction = null;
    panelMinimized = false;
    pillDom = null;
  };

  // ---------------------------------------------------------------------------
  // Quick menu (F9): daftar replay di tengah layar
  // ---------------------------------------------------------------------------
  overlay.quickIsOpen = function () {
    return !!(ui.quick && ui.quick.isConnected);
  };

  overlay.closeQuick = function () {
    if (ui.quick) {
      ui.quick.remove();
      ui.quick = null;
    }
    if (ui.quickEscHandler) {
      document.removeEventListener("keydown", ui.quickEscHandler, true);
      ui.quickEscHandler = null;
    }
  };

  /**
   * Tampilkan quick menu. entries: [{id, name, meta}]; opts.onReplay(id)
   * dipanggil saat item diklik; opts.statusText menampilkan baris status.
   */
  function quickItem(rec, opts, extraClass) {
    var item = el("button", { class: "tst-quick-item" + (extraClass || "") });
    item.appendChild(el("span", { class: "tst-quick-name" }, rec.name));
    item.appendChild(el("span", { class: "tst-quick-meta" }, rec.meta || ""));
    item.addEventListener("click", function () {
      overlay.closeQuick();
      if (typeof opts.onReplay === "function") opts.onReplay(rec.id);
    });
    return item;
  }

  overlay.showQuickMenu = function (entries, opts) {
    overlay.closeQuick();
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
    opts = opts || {};

    var backdrop = el("div", { class: "tst-quick-backdrop" });
    var card = el("div", { class: "tst-quick" });

    var head = el("div", { class: "tst-quick-head" });
    head.appendChild(el("span", { class: "tst-quick-title" }, "⚡ Testeria — Quick Replay"));
    var closeBtn = el("button", { class: "tst-quick-x", title: "Tutup (F9)" }, "×");
    closeBtn.addEventListener("click", function () {
      overlay.closeQuick();
    });
    head.appendChild(closeBtn);
    card.appendChild(head);

    if (opts.statusText) {
      card.appendChild(el("div", { class: "tst-quick-status" }, opts.statusText));
    }

    var list = el("div", { class: "tst-quick-list" });
    if (!entries || !entries.length) {
      list.appendChild(
        el("div", { class: "tst-quick-empty" }, "Belum ada recording. Tekan F8 di halaman untuk mulai merekam.")
      );
    } else {
      // Tanpa grup dulu, lalu per grup (Proyek ▸ Modul) terurut abjad.
      var plain = entries.filter(function (e) { return !e.group; });
      plain.forEach(function (rec) {
        list.appendChild(quickItem(rec, opts));
      });
      var groups = {};
      entries.forEach(function (e) {
        if (e.group) (groups[e.group] = groups[e.group] || []).push(e);
      });
      Object.keys(groups).sort().forEach(function (path) {
        list.appendChild(
          el("div", { class: "tst-quick-group" }, String(path).split("/").filter(Boolean).join(" ▸ "))
        );
        groups[path].forEach(function (rec) {
          list.appendChild(quickItem(rec, opts, " tst-quick-indent"));
        });
      });
    }
    card.appendChild(list);

    // Setelan cepat di quick menu: mode kursor (halus ⇄ instan). Ditulis
    // langsung ke storage — main.js menyinkronkan ke overlay lewat
    // storage.onChanged, jadi efeknya LIVE tanpa buka popup.
    var setRow = el("div", { class: "tst-quick-set" });
    var setBtn = el("button", { class: "tst-quick-toggle", type: "button" }, "Kursor: …");
    setRow.appendChild(setBtn);
    setRow.appendChild(el("span", { class: "tst-quick-sethint" }, "bisa juga di ⚙ Setelan popup"));
    card.appendChild(setRow);
    function paintSet(s) {
      setBtn.textContent =
        "Kursor: " + (s && s.replayInstant ? "instan (tanpa animasi)" : "halus (animasi)");
    }
    api.storage.local
      .get("settings")
      .then(function (r) {
        paintSet(r && r.settings);
      })
      .catch(function () {});
    setBtn.addEventListener("click", function () {
      api.storage.local
        .get("settings")
        .then(function (r) {
          var s = Object.assign({}, (r && r.settings) || {});
          s.replayInstant = !s.replayInstant;
          return api.storage.local.set({ settings: s }).then(function () {
            paintSet(s);
          });
        })
        .catch(function () {});
    });

    var footText = "F8 start/stop record · F9 buka/tutup menu ini · Escape tutup";
    try {
      footText += " · Testeria v" + api.runtime.getManifest().version;
    } catch (e) { }
    card.appendChild(el("div", { class: "tst-quick-foot" }, footText));
    backdrop.appendChild(card);

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) overlay.closeQuick();
    });

    root.appendChild(backdrop);
    ui.quick = backdrop;

    // Escape/F9 menutup menu (ditangani di level document supaya fokus
    // boleh di mana saja).
    ui.quickEscHandler = function (e) {
      if (e.key === "Escape" || e.key === "F9") {
        e.preventDefault();
        e.stopPropagation();
        overlay.closeQuick();
      }
    };
    document.addEventListener("keydown", ui.quickEscHandler, true);
  };

  /**
   * Prompt pengisian password manual saat replay.
   * Resolve dengan string yang diketik (atau null bila dibatalkan).
   * Nilai ini TIDAK disimpan ke mana pun — hanya dipakai replayer sekali pakai.
   */
  overlay.showPasswordPrompt = function (stepNumber) {
    return new Promise(function (resolve) {
      overlay.closeModal();
      // Backdrop modal menutupi panel replay — panel yang terlihat tapi tak
      // bisa diklik = dead UI. Sembunyikan; perubahan status berikutnya
      // (failed setelah Batal / running setelah Lanjut) me-render ulang panel.
      overlay.hideReplay();
      var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
      var backdrop = el("div", { class: "backdrop" });
      var card = el("div", { class: "card" });
      card.appendChild(el("h2", null, "Testeria — password dibutuhkan"));
      card.appendChild(
        el(
          "p",
          null,
          "Step " + stepNumber + " mengisi field password. Password tidak direkam saat recording, jadi isi manual sekali ini — nilainya tidak akan disimpan."
        )
      );
      var input = el("input", { type: "password", placeholder: "Password" });
      card.appendChild(input);
      var actions = el("div", { class: "actions" });
      var cancel = el("button", { class: "btn-secondary" }, "Batalkan replay");
      var go = el("button", { class: "btn-primary" }, "Lanjut");
      input.addEventListener("keydown", function (e) {
        e.stopPropagation();
        if (e.key === "Enter") go.click();
      });
      // Escape = batalkan (README mengklaim ini sejak awal; kini benar-benar ada).
      // CAPTURE phase: handler keydown input memanggil stopPropagation, jadi
      // listener bubble di backdrop tidak pernah melihat Escape (ditemukan saat
      // playtest — Escape diam saja). Capture di backdrop menangkap sebelum itu.
      backdrop.addEventListener(
        "keydown",
        function (e) {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          overlay.closeModal();
          resolve(null);
        },
        true
      );
      cancel.addEventListener("click", function () {
        overlay.closeModal();
        resolve(null);
      });
      go.addEventListener("click", function () {
        var v = input.value;
        overlay.closeModal();
        resolve(v);
      });
      actions.appendChild(cancel);
      actions.appendChild(go);
      card.appendChild(actions);
      backdrop.appendChild(card);
      root.appendChild(backdrop);
      ui.modal = backdrop;
      setTimeout(function () {
        try {
          input.focus();
        } catch (e) { }
      }, 50);
    });
  };
})();
