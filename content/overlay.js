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
    trail: null,
    trailPts: null,
    trailLive: false,
    trailFade: null,
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
    // ---- jejak mouse (polyline kecil yang mengikuti animasi kursor) ----
    ".tst-trail { position: fixed; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; }",
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

    // Polyline jejak yang mengikuti animasi kursor.
    var trail = document.createElement("div");
    trail.className = "tst-trail";
    trail.innerHTML =
      '<svg width="100%" height="100%">' +
      '<defs><linearGradient id="tstg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#7c4dff"/><stop offset="1" stop-color="#e91e8c"/>' +
      '</linearGradient></defs>' +
      '<polyline points="" fill="none" stroke="url(#tstg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0"/>' +
      '</svg>';
    host.appendChild(trail);
    ui.trail = trail;

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

  var rafState = { running: false };

  function startRaf() {
    if (rafState.running) return;
    rafState.running = true;
    requestAnimationFrame(rafTick);
  }

  function rafTick() {
    if (!rafState.running) return;
    var now = performance.now();
    var stillAnimating = false;

    // (1) posisi kursor terkini
    if (ui.cursor && ui.cursorX != null) {
      ui.cursor.style.transform =
        "translate(" + Math.round(ui.cursorX) + "px," + Math.round(ui.cursorY) + "px)";
    }

    // (2) jejak: mengikuti kursor saat terbang, lalu disusutkan titik demi
    // titik dan memudar — loop WAJIB berakhir (tidak ada rAF abadi).
    var poly = ui.trail ? ui.trail.querySelector("polyline") : null;
    if (poly) {
      if (ui.trailLive && ui.trailPts && ui.trailPts.length) {
        ui.trailPts.push([ui.cursorX || 0, ui.cursorY || 0]);
        if (ui.trailPts.length > 18) ui.trailPts.shift();
        poly.setAttribute("points", ui.trailPts.map(function (p) {
          return p[0].toFixed(1) + "," + p[1].toFixed(1);
        }).join(" "));
        poly.setAttribute("opacity", "0.55");
        stillAnimating = true;
      } else if (ui.trailPts && ui.trailPts.length) {
        ui.trailPts.shift(); // susutkan jejak setelah kursor berhenti
        poly.setAttribute("points", ui.trailPts.map(function (p) {
          return p[0].toFixed(1) + "," + p[1].toFixed(1);
        }).join(" "));
        poly.setAttribute("opacity", "0.45");
        if (!ui.trailPts.length) ui.trailFade = now;
        stillAnimating = true;
      } else if (ui.trailFade != null && now - ui.trailFade < 600) {
        poly.setAttribute("opacity", String(0.45 * (1 - (now - ui.trailFade) / 600)));
        stillAnimating = true;
      } else {
        if (poly.getAttribute("points")) {
          poly.setAttribute("points", "");
          poly.setAttribute("opacity", "0");
        }
        ui.trailFade = null;
      }
    }

    if (stillAnimating) {
      requestAnimationFrame(rafTick);
    } else {
      rafState.running = false;
    }
  }

  function drawTrail(pointsPx) {
    if (!ui.trail) return;
    ui.trailPts = pointsPx.map(function (p) {
      return [p[0], p[1]];
    });
    ui.trailLive = true;
    ui.trailFade = null;
    startRaf();
  }

  /**
   * Gerakkan kursor virtual menyusuri jejak mouse yang terekam (animasi
   * requestAnimationFrame, kecepatan konstan ~1.4 px/ms) lalu sampai tujuan.
   * Bentuk menyesuaikan: I-beam di atas field teks, kelopak di tempat lain.
   * Resolve saat kursor tiba. Tanpa jejak terekam: gerak langsung halus.
   */
  overlay.vcMoveTo = function (x, y, label, path) {
    if (!ui.cursorHost || !ui.cursorHost.isConnected || !ui.cursor) {
      return Promise.resolve(false);
    }
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var beam = isTextInputAt(x, y);
    setCursorArt(beam ? "beam" : "arrow");
    if (ui.cursorLabel) {
      ui.cursorLabel.textContent = label ? "Testeria: " + label : "";
    }
    if (label) ui.cursor.classList.add("show-lbl");
    else ui.cursor.classList.remove("show-lbl");

    // Jalur: jejak terekam (ternormalisasi → px) + titik tujuan di akhir.
    var pts = [];
    if (Array.isArray(path) && path.length > 1) {
      for (var i = 0; i < path.length; i++) {
        var p = path[i];
        var px = (typeof p.x === "number" && p.x <= 1.5 ? p.x * vw : p.x);
        var py = (typeof p.y === "number" && p.y <= 1.5 ? p.y * vh : p.y);
        pts.push([px, py]);
      }
    }
    pts.push([x, y]);

    // Hapus titik awal yang terlalu dekat (hindari segmen nol)
    pts = pts.filter(function (p, idx) {
      if (idx === 0) return true;
      var prev = pts[idx - 1];
      return Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) > 2;
    });

    // Posisi awal: dari posisi kursor saat ini (lanjutan mulus antar step)
    var startX = ui.cursorX == null ? pts[0][0] : ui.cursorX;
    var startY = ui.cursorY == null ? pts[0][1] : ui.cursorY;
    if (Math.abs(startX - pts[0][0]) + Math.abs(startY - pts[0][1]) > 40) {
      // Posisi kursor jauh dari awal jejak: mulai dari kursor, sambung ke jejak
      pts.unshift([startX, startY]);
    }

    var SPEED = 1.4; // px per ms
    var total = 0;
    var segs = [];
    for (var s = 1; s < pts.length; s++) {
      var dx = pts[s][0] - pts[s - 1][0];
      var dy = pts[s][1] - pts[s - 1][1];
      var len = Math.sqrt(dx * dx + dy * dy);
      segs.push(len);
      total += len;
    }
    var duration = Math.max(140, Math.min(1400, total / SPEED));

    return new Promise(function (resolve) {
      if (total < 1) {
        ui.cursorX = x;
        ui.cursorY = y;
        ui.cursor.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
        resolve(true);
        return;
      }
      var startTime = null;
      function frame(ts) {
        if (startTime == null) startTime = ts;
        var t = Math.min(1, (ts - startTime) / duration);
        // Easing ease-in-out ringan biar start/stop terasa hidup
        var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        var targetDist = total * e;
        var acc = 0;
        var px = pts[pts.length - 1][0], py = pts[pts.length - 1][1];
        for (var k = 0; k < segs.length; k++) {
          if (acc + segs[k] >= targetDist) {
            var f = segs[k] > 0 ? (targetDist - acc) / segs[k] : 0;
            px = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f;
            py = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f;
            break;
          }
          acc += segs[k];
        }
        ui.cursorX = px;
        ui.cursorY = py;
        drawTrail(pts.slice(0, k + 2).map(function (p) { return p.slice(); }));
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          ui.cursorX = x;
          ui.cursorY = y;
          ui.cursor.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
          ui.trailLive = false; // jejak mulai disusutkan & memudar
          startRaf();
          resolve(true);
        }
      }
      requestAnimationFrame(frame);
    });
  };

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
    rafState.running = false; // hentikan loop animasi
    if (ui.cursorHost) {
      ui.cursorHost.remove();
      ui.cursorHost = null;
      ui.cursor = null;
      ui.cursorLabel = null;
      ui.ambient = null;
      ui.trail = null;
      ui.trailPts = null;
      ui.trailFade = null;
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
    ".tst-quick-foot { padding: 8px 14px; border-top: 1px solid rgba(124,77,255,.25);",
    "  font: 400 10.5px/1.4 system-ui, sans-serif; color: #8d7fb8; }"
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
  // Replay: progress pill, failure panel, password prompt
  // ---------------------------------------------------------------------------
  overlay.showReplayProgress = function (stepNumber, total) {
    overlay.hideReplay();
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
    var pill = el("div", { class: "pill" }, "Testeria replay — step " + stepNumber + "/" + total);
    var row = el("div", { class: "row" });
    var pause = el("button", null, "Pause");
    pause.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_REPLAY_PAUSE" }).catch(function () { });
    });
    var stop = el("button", { class: "primary" }, "Stop");
    stop.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_STOP_REPLAY" }).catch(function () { });
      overlay.hideReplay();
    });
    row.appendChild(pause);
    row.appendChild(stop);
    pill.appendChild(row);
    ui.pill = pill;
    root.appendChild(pill);
  };

  /** Pill saat replay dijeda: halaman bebas diedit, lalu lanjut/skip/stop. */
  overlay.showReplayPaused = function (stepNumber, total) {
    overlay.hideReplay();
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
    var pill = el("div", { class: "pill" });
    pill.appendChild(el("div", null, "Testeria replay DIJEDA — step " + stepNumber + "/" + total));
    pill.appendChild(
      el(
        "div",
        { style: "color:#c58af9" },
        "Halaman bebas Anda utak-atik (isi input, tutup popup), lalu lanjutkan."
      )
    );
    var row = el("div", { class: "row" });
    var resume = el("button", { class: "primary" }, "Lanjutkan");
    resume.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_REPLAY_RESUME" }).catch(function () { });
      overlay.hideReplay();
    });
    var skip = el("button", null, "Skip step");
    skip.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_REPLAY_SKIP" }).catch(function () { });
      overlay.hideReplay();
    });
    var stop = el("button", null, "Stop");
    stop.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_STOP_REPLAY" }).catch(function () { });
      overlay.hideReplay();
    });
    row.appendChild(resume);
    row.appendChild(skip);
    row.appendChild(stop);
    pill.appendChild(row);
    ui.pill = pill;
    root.appendChild(pill);
  };

  overlay.showReplayFailure = function (message) {
    overlay.hideReplay();
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
    var pill = el("div", { class: "pill" });
    pill.appendChild(el("div", null, "Testeria replay GAGAL"));
    pill.appendChild(el("div", { style: "color:#f28b82" }, message));
    var row = el("div", { class: "row" });
    var retry = el("button", null, "Retry step");
    var stop = el("button", { class: "primary" }, "Stop");
    retry.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_REPLAY_RETRY" }).catch(function () { });
    });
    stop.addEventListener("click", function () {
      api.runtime.sendMessage({ type: "TESTERIA_STOP_REPLAY" }).catch(function () { });
      overlay.hideReplay();
    });
    row.appendChild(retry);
    row.appendChild(stop);
    pill.appendChild(row);
    ui.pill = pill;
    root.appendChild(pill);
  };

  overlay.showReplayDone = function () {
    overlay.hideReplay();
    var root = ui.root && ui.host && ui.host.isConnected ? ui.root : ensureRoot();
    var pill = el("div", { class: "pill" }, "Testeria replay selesai ✓");
    ui.pill = pill;
    root.appendChild(pill);
    setTimeout(function () {
      if (ui.pill === pill) overlay.hideReplay();
    }, 4000);
  };

  overlay.hideReplay = function () {
    if (ui.pill) {
      ui.pill.remove();
      ui.pill = null;
    }
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
