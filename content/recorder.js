/*
 * Testeria — content/recorder.js
 *
 * Capture event halaman menjadi step data murni dan kirim ke background
 * (yang menyimpannya di storage.local, bukan memory).
 *
 * Yang direkam: click, dblclick, contextmenu, input teks (debounce 500 ms),
 * change (select/checkbox/radio), key penting (Enter/Tab/Escape/arrow).
 *
 * URL TIDAK PERNAH menjadi step: navigasi SPA (pushState/replaceState/popstate)
 * sengaja tidak direkam — route berubah karena FE menanggapi aksi user yang
 * memang terekam, sehingga id halaman baru dihasilkan FE, bukan dipaksakan URL
 * rekaman. Ganti dokumen penuh (submit form/redirect antar-dokumen) dicatat
 * background lewat PAGE_READY sebagai penanda TANPA URL `pageload`.
 *
 * Yang TIDAK direkam: scroll (v1), jejak mouse (path) — kursor virtual replay
 * kini bergerak glide halus tanpa jejak terekam, penekanan F8/Ctrl+Shift+Y (toggle sendiri),
 * event pada UI overlay Testeria sendiri, event SINTETIS buatan aplikasi
 * (isTrusted:false — komponen menu/accordion sering me-re-dispatch click;
 * tanpa filter ini satu klik terekam dua kali dan menu kebuka lalu ketutup
 * lagi saat replay), dan value password asli (diganti "<masked>" + masked:true).
 *
 * Setiap step menyimpan `kind` (sidik jari jenis elemen) dan `name` (nama
 * manusiawi: label field / teks tombol) — dipakai replayer untuk menolak
 * kandidat selector yang salah elemen dan panel untuk menampilkan daftar step
 * yang bisa dibaca manusia.
 *
 * Aman dievaluasi ulang: listener dipasang sekali (guard), state di-reset.
 */
var recorder = (globalThis.TESTERIA_RECORDER = globalThis.TESTERIA_RECORDER || {});
(function () {
  "use strict";

  // IDEMPOTEN: executeScript recovery mengevaluasi ulang file ini. Tanpa guard,
  // IIFE membuat `state` baru dan memasang listener KEDUA — setiap aksi user
  // terekam ganda (ditemukan via E2E Playwright). Bila sudah terpasang,
  // pertahankan state & listener lama apa adanya.
  if (recorder.__installed) return;

  var api = globalThis.browser;
  var DEBOUNCE_MS = 500;

  var state = {
    recording: false,
    timers: new WeakMap(), // elemen input -> id timer debounce
    lastValue: new WeakMap(), // elemen -> nilai terakhir yang SUDAH direkam
    pendingEls: [], // elemen dengan debounce aktif (untuk flushAllPending)
    installed: false
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

  function valueFor(el, noMask) {
    if (!noMask && isPassword(el)) return { value: "<masked>", masked: true };
    var v = el.value == null ? "" : String(el.value);
    return { value: v, masked: false };
  }

  /**
   * Mode assertion default untuk elemen (Alt+Click = "pastikan elemen ini…"):
   *   checkbox/radio → "checked"  |  input/textarea/select → "value"
   *   elemen lain → "text" (mengandung teks yang terlihat saat ini).
   * Nilai password TIDAK pernah terekam — di-mask dengan aturan yang sama
   * dengan step input biasa.
   */
  function assertionFor(el) {
    var sel = selectorFor(el);
    var step = { type: "assert", selector: sel, value: null };
    var tag = el.tagName;
    if (tag === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      // Chrome/Firefox PRE-TOGGLE checkedness checkbox/radio SELAMA dispatch
      // klik lalu mengembalikannya bila preventDefault (legacy-canceled
      // activation) — di DALAM listener el.checked = KEBALIKAN yang dilihat
      // user. Kita selalu preventDefault → balikkan saat capture.
      step.assertMode = "checked";
      step.value = el.checked ? "unchecked" : "checked";
    } else if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      var v = valueFor(el, false);
      step.assertMode = "value";
      step.value = v.value;
      step.masked = v.masked;
    } else {
      step.assertMode = "text";
      step.value = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
    }
    return step;
  }

  function selectorFor(el) {
    var gen = globalThis.TESTERIA_SELECTOR;
    try {
      return gen ? gen.buildSelector(el) : null;
    } catch (e) {
      return null;
    }
  }

  /** Sidik jari jenis elemen (untuk verifikasi saat replay). */
  function kindFor(el) {
    var gen = globalThis.TESTERIA_SELECTOR;
    try {
      return gen && gen.describeElement ? gen.describeElement(el) : null;
    } catch (e) {
      return null;
    }
  }

  /** Nama manusiawi elemen (label field / teks tombol) — bukan selector. */
  function nameFor(el) {
    var gen = globalThis.TESTERIA_SELECTOR;
    try {
      var n = gen && gen.friendlyName ? gen.friendlyName(el) : "";
      return n || null;
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
    if (!el.isConnected || el.disabled) return;
    var v = valueFor(el);
    var last = state.lastValue.get(el);
    if (last === v.value) return; // tidak ada perubahan sejak rekaman terakhir
    state.lastValue.set(el, v.value);
    sendStep({
      type: "input",
      selector: selectorFor(el),
      kind: kindFor(el),
      name: nameFor(el),
      value: v.value,
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
  // Event listeners (capture, terpasang sekali)
  // ---------------------------------------------------------------------------

  function onClick(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || el.nodeType !== 1) return;
    // Flush input yang masih menunggu debounce supaya urutan step benar.
    if (isEditable(el)) flushInput(el);
    // Alt+Click = tulis ASSERTION ("pastikan elemen ini…"), bukan aksi klik.
    // Kliknya DITELAN: tanpa ini Alt+Click di link bernavigasi, di checkbox
    // toggles, di tombol mengeksekusi — assertion tidak boleh mengubah halaman.
    // Capture SINKRON (bukan setTimeout): state yang dilihat user ada SEKARANG
    // (untuk checkbox lihat pre-toggle di assertionFor); deferral bisa kalah
    // balapan dengan stop-toggle yang menonaktifkan recording lebih dulu.
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var assertStep = assertionFor(el);
      assertStep.kind = kindFor(el);
      assertStep.name = nameFor(el);
      sendStep(assertStep);
      return;
    }
    sendStep({
      type: "click",
      selector: selectorFor(el),
      kind: kindFor(el),
      name: nameFor(el),
      value: null
    });
  }

  function onDblClick(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || el.nodeType !== 1) return;
    sendStep({
      type: "click",
      selector: selectorFor(el),
      kind: kindFor(el),
      name: nameFor(el),
      value: null,
      dblclick: true
    });
  }

  function onContextMenu(e) {
    if (!state.recording || !isTrustedEvent(e) || fromOwnOverlay(e)) return;
    var el = realTarget(e);
    if (!el || el.nodeType !== 1) return;
    sendStep({
      type: "click",
      selector: selectorFor(el),
      kind: kindFor(el),
      name: nameFor(el),
      value: null,
      button: "right"
    });
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
    // Elemen yang sudah dibuang dari DOM / disabled bukan aksi user yang bisa
    // direplay (form kondisional sering membuang elemen lama saat re-render).
    if (!el.isConnected || el.disabled) return;
    if (el.tagName === "INPUT" && String(el.type || "").toLowerCase() === "hidden") return;

    if (el.tagName === "SELECT") {
      state.lastValue.set(el, el.value);
      sendStep({
        type: "select",
        selector: selectorFor(el),
        kind: kindFor(el),
        name: nameFor(el),
        value: el.value
      });
      return;
    }

    if (el.type === "checkbox" || el.type === "radio") {
      state.lastValue.set(el, String(el.checked));
      sendStep({
        type: "check",
        selector: selectorFor(el),
        kind: kindFor(el),
        name: nameFor(el),
        value: el.checked ? "checked" : "unchecked"
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
      kind: el && el.nodeType === 1 ? kindFor(el) : null,
      name: el && el.nodeType === 1 ? nameFor(el) : null,
      value: name
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
  // Navigasi: TIDAK direkam sebagai step.
  //
  // SPA (pushState/replaceState/popstate) → route berubah karena FE menanggapi
  // aksi user yang sudah terekam; menambahkan step URL justru memaksa replay
  // kembali ke id lama (mis. /wo/123 padahal user sedang di /so/456).
  // Ganti dokumen penuh → background mencatat penanda TANPA URL (`pageload`)
  // dari PAGE_READY dokumen baru.
  // ---------------------------------------------------------------------------

  /**
   * Flush SEMUA input yang masih menunggu debounce (urutan pendaftaran).
   * Dipanggil saat document dibongkar, supaya ketikan <500 ms sebelum
   * navigasi tidak hilang dari recording.
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

  // ---------------------------------------------------------------------------
  // Init sekali per halaman
  // ---------------------------------------------------------------------------
  recorder.init = function () {
    installListeners();
  };
  recorder.init();
  recorder.__installed = true;
})();
