/*
 * Testeria — content/recorder.js
 *
 * Capture event halaman menjadi step data murni dan kirim ke background
 * (yang menyimpannya di storage.local, bukan memory).
 *
 * Yang direkam: click, dblclick, contextmenu, input teks (debounce 500 ms),
 * change (select/checkbox/radio), key penting (Enter/Tab/Escape/arrow),
 * navigasi URL (SPA pushState/replaceState/popstate; full page load ditangani
 * background lewat PAGE_READY).
 *
 * Yang TIDAK direkam: scroll (v1), penekanan F8/Ctrl+Shift+Y (toggle sendiri),
 * event pada UI overlay Testeria sendiri, event SINTETIS buatan aplikasi
 * (isTrusted:false — komponen menu/accordion sering me-re-dispatch click;
 * tanpa filter ini satu klik terekam dua kali dan menu kebuka lalu ketutup
 * lagi saat replay), dan value password asli (diganti "<masked>" + masked:true).
 *
 * Aman dievaluasi ulang: listener dipasang sekali (guard), state di-reset.
 */
var recorder = (globalThis.TESTERIA_RECORDER = globalThis.TESTERIA_RECORDER || {});
(function () {
  "use strict";

  var api = globalThis.browser;
  var DEBOUNCE_MS = 500;

  var state = {
    recording: false,
    timers: new WeakMap(), // elemen input -> id timer debounce
    lastValue: new WeakMap(), // elemen -> nilai terakhir yang SUDAH direkam
    pendingEls: [], // elemen dengan debounce aktif (untuk flushAllPending)
    mouseTrail: [], // jejak mouse tersampel untuk animasi kursor saat replay
    lastMoveSample: 0,
    installed: false,
    spaPatched: false
  };

  recorder.isRecording = function () {
    return state.recording;
  };

  recorder.setRecording = function (flag) {
    state.recording = !!flag;
    if (state.recording) {
      state.timers = new WeakMap();
      state.lastValue = new WeakMap();
      state.pendingEls = [];
      state.mouseTrail = [];
      state.lastMoveSample = 0;
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Hanya event asli hasil interaksi user yang direkam. Klik programatik
   * aplikasi (el.click() / dispatchEvent) ber-isTrusted:false — umumnya
   * re-dispatch dari komponen menu/dropdown/accordion 3–8 ms setelah klik
   * asli; kalau ikut terekam, replay mengeksekusi aksi dua kali.
   */
  function isTrustedEvent(e) {
    return e && e.isTrusted !== false;
  }

  /** Target event yang sebenarnya (tembus Shadow DOM terbuka). */
  function realTarget(e) {
    try {
      var path = e.composedPath ? e.composedPath() : null;
      if (path && path.length && path[0] instanceof Element) return path[0];
    } catch (err) {}
    return e.target;
  }

  /** Abaikan event pada UI overlay Testeria sendiri. */
  function fromOwnOverlay(e) {
    try {
      var path = e.composedPath ? e.composedPath() : [];
      for (var i = 0; i < path.length; i++) {
        var n = path[i];
        if (n && n.id === "__testeria-host") return true;
      }
    } catch (err) {}
    return false;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function isPassword(el) {
    return el && el.tagName === "INPUT" && (el.type || "").toLowerCase() === "password";
  }

  function valueFor(el) {
    if (isPassword(el)) return { value: "<masked>", masked: true };
    var v = el.value == null ? "" : String(el.value);
    return { value: v, masked: false };
  }

  function selectorFor(el) {
    var gen = globalThis.TESTERIA_SELECTOR;
    try {
      return gen ? gen.buildSelector(el) : null;
    } catch (e) {
      return null;
    }
  }

  function sendStep(step) {
    step.ts = 0; // background mengisi ts relatif & delayMs (clamp 0..2000)
    step.delayMs = 0;
    try {
      api.runtime.sendMessage({ type: "TESTERIA_RECORD_STEP", step: step }).catch(function () {});
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // Input debounce: satu step per rangkaian ketikan
  // ---------------------------------------------------------------------------

  function pushInputStep(el) {
    if (!state.recording || !isEditable(el) || el.tagName === "SELECT") return;
    var v = valueFor(el);
    var last = state.lastValue.get(el);
    if (last === v.value) return; // tidak ada perubahan sejak rekaman terakhir
    state.lastValue.set(el, v.value);
    sendStep({
      type: "input",
      selector: selectorFor(el),
      value: v.value,
      url: null,
      masked: v.masked
    });
  }

  function flushInput(el) {
    var t = state.timers.get(el);
    if (t) {
      clearTimeout(t);
      state.timers.delete(el);
      removePending(el);
      pushInputStep(el);
    }
  }

  function removePending(el) {
    var idx = state.pendingEls.indexOf(el);
    if (idx !== -1) state.pendingEls.splice(idx, 1);
  }

  function scheduleInput(el) {
    if (state.timers.get(el)) clearTimeout(state.timers.get(el));
    else if (state.pendingEls.indexOf(el) === -1) state.pendingEls.push(el);
    var id = setTimeout(function () {
      state.timers.delete(el);
      removePending(el);
      pushInputStep(el);
    }, DEBOUNCE_MS);
    state.timers.set(el, id);
  }

  // ---------------------------------------------------------------------------
  // Jejak mouse (untuk animasi kursor virtual saat replay)
  // ---------------------------------------------------------------------------
  // Disampel tiap ±90 ms, dinormalisasi 0..1 terhadap viewport supaya tetap
  // benar saat replay di ukuran jendela berbeda. Klik menyimpan salinan
  // trail terakhir sebagai step.path (maks 16 titik).

  var TRAIL_SAMPLE_MS = 90;
  var TRAIL_MAX_POINTS = 24;
  var TRAIL_STEP_POINTS = 16;

  function onMouseMove(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var now = Date.now();
    if (now - state.lastMoveSample < TRAIL_SAMPLE_MS) return;
    state.lastMoveSample = now;
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    state.mouseTrail.push({
      x: Math.round(((e.clientX || 0) / vw) * 1000) / 1000,
      y: Math.round(((e.clientY || 0) / vh) * 1000) / 1000,
      t: now
    });
    if (state.mouseTrail.length > TRAIL_MAX_POINTS) state.mouseTrail.shift();
  }

  /** Salinan trail terakhir (tanpa timestamp) untuk step, atau null. */
  function trailSnapshot() {
    if (state.mouseTrail.length < 2) return null;
    return state.mouseTrail.slice(-TRAIL_STEP_POINTS).map(function (p) {
      return { x: p.x, y: p.y };
    });
  }

  // ---------------------------------------------------------------------------
  // Event listeners (capture, terpasang sekali)
  // ---------------------------------------------------------------------------

  function onClick(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || el.nodeType !== 1) return;
    // Flush input yang masih menunggu debounce supaya urutan step benar.
    if (isEditable(el)) flushInput(el);
    var step = {
      type: "click",
      selector: selectorFor(el),
      value: null,
      url: null
    };
    var path = trailSnapshot();
    if (path) step.path = path;
    sendStep(step);
  }

  function onDblClick(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || el.nodeType !== 1) return;
    var step = {
      type: "click",
      selector: selectorFor(el),
      value: null,
      url: null,
      dblclick: true
    };
    var path = trailSnapshot();
    if (path) step.path = path;
    sendStep(step);
  }

  function onContextMenu(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || el.nodeType !== 1) return;
    var step = {
      type: "click",
      selector: selectorFor(el),
      value: null,
      url: null,
      button: "right"
    };
    var path = trailSnapshot();
    if (path) step.path = path;
    sendStep(step);
  }

  function onInput(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || !isEditable(el)) return; // contenteditable dll: di luar scope v1
    if (el.tagName === "SELECT") return; // select lewat 'change'
    if (el.type === "checkbox" || el.type === "radio") return; // lewat 'change'
    scheduleInput(el);
  }

  function onChange(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || !isEditable(el)) return;

    if (el.tagName === "SELECT") {
      state.lastValue.set(el, el.value);
      sendStep({
        type: "select",
        selector: selectorFor(el),
        value: el.value,
        url: null
      });
      return;
    }

    if (el.type === "checkbox" || el.type === "radio") {
      state.lastValue.set(el, String(el.checked));
      sendStep({
        type: "check",
        selector: selectorFor(el),
        value: el.checked ? "checked" : "unchecked",
        url: null
      });
      return;
    }

    // Input/textarea: 'change' berarti selesai (blur/Enter) → flush langsung.
    var hadTimer = state.timers.has(el);
    flushInput(el);
    if (!hadTimer) pushInputStep(el); // kasus change tanpa input sebelumnya (mis. autofill)
  }

  var RECORDED_KEYS = {
    Enter: "Enter",
    Tab: "Tab",
    Escape: "Escape",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight"
  };

  function onKeyDown(e) {
    // Toggle sendiri TIDAK boleh terekam.
    if (e.key === "F8") return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "Y" || e.key === "y")) return;
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;

    var name = RECORDED_KEYS[e.key];
    if (!name) return; // keystroke biasa ter-cover oleh step 'input'

    var el = realTarget(e);
    if (el && isEditable(el)) flushInput(el);

    sendStep({
      type: "key",
      selector: el && el.nodeType === 1 ? selectorFor(el) : null,
      value: name,
      url: null
    });
  }

  function installListeners() {
    if (state.installed) return;
    state.installed = true;
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDblClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onChange, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("blur", onBlur, true);
    document.addEventListener("mousemove", onMouseMove, true);
    // Full page load: document dibongkar — flush ketikan yang belum terekam.
    // (step navigate untuk full load sendiri direkam background lewat PAGE_READY.)
    window.addEventListener("pagehide", function () {
      flushAllPending();
    });
  }

  function onBlur(e) {
    if (!state.recording) return;
    var el = e.target;
    if (el && el.nodeType === 1 && isEditable(el)) flushInput(el);
  }

  // ---------------------------------------------------------------------------
  // Navigasi SPA (pushState/replaceState/popstate) → step navigate
  // Full page load ditangani background lewat TESTERIA_PAGE_READY.
  // ---------------------------------------------------------------------------

  /**
   * Flush SEMUA input yang masih menunggu debounce (urutan pendaftaran).
   * Dipanggil sebelum step navigate direkam dan saat document dibongkar,
   * supaya ketikan <500 ms sebelum navigasi tidak hilang dari recording.
   */
  function flushAllPending() {
    if (!state.recording) return;
    var pending = state.pendingEls.slice();
    state.pendingEls = [];
    for (var i = 0; i < pending.length; i++) {
      var el = pending[i];
      var t = state.timers.get(el);
      if (t) {
        clearTimeout(t);
        state.timers.delete(el);
        pushInputStep(el);
      }
    }
  }

  function currentHref() {
    try {
      return location.href;
    } catch (e) {
      return null;
    }
  }

  function sendNavigate(url) {
    if (!state.recording) return;
    if (!/^https?:/i.test(url || "")) return;
    // Ketikan terakhir sebelum pindah halaman harus masuk recording lebih dulu.
    flushAllPending();
    sendStep({ type: "navigate", selector: null, value: null, url: url });
  }

  function patchHistory() {
    if (state.spaPatched) return;
    state.spaPatched = true;
    var lastHref = currentHref();

    function wrap(fnName) {
      try {
        var orig = history[fnName];
        if (typeof orig !== "function") return;
        history[fnName] = function () {
          var r = orig.apply(this, arguments);
          setTimeout(function () {
            var now = currentHref();
            if (now && now !== lastHref) {
              lastHref = now;
              sendNavigate(now);
            }
          }, 0);
          return r;
        };
      } catch (e) {}
    }
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", function () {
      setTimeout(function () {
        var now = currentHref();
        if (now && now !== lastHref) {
          lastHref = now;
          sendNavigate(now);
        }
      }, 0);
    });
  }

  // ---------------------------------------------------------------------------
  // Init sekali per halaman
  // ---------------------------------------------------------------------------
  recorder.init = function () {
    installListeners();
    patchHistory();
  };
  recorder.init();
})();
