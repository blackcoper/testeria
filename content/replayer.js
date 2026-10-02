/*
 * Testeria — content/replayer.js
 *
 * Eksekusi satu step replay di halaman:
 *   - resolve elemen dengan SKORING KANDIDAT: koneksi → jenis elemen cocok
 *     (sidik jari step.kind dari recorder) → visible → kecocokan atribut.
 *     Kandidat yang jenisnya berbeda DITOLAK — step gagal eksplisit, tidak
 *     pernah diam-diam mengklik elemen lain (akar bug "checkbox hantu" pada
 *     form kondisional: selector path yang valid saat merkam bisa cocok ke
 *     kontrol lain setelah field kondisional disembunyikan).
 *   - verifikasi ULANG setelah animasi kursor: elemen yang diganti/detach
 *     selama glide tidak dieksekusi sebagai node mati (dulu step dilaporkan
 *     sukses padahal tidak terjadi apa-apa di halaman).
 *   - set value via NATIVE value setter dari prototype yang benar + dispatch
 *     event `input` + `change` (bubbles) supaya framework (React/Vue/Angular)
 *     menangkap perubahan.
 *   - click/dblclick/contextmenu native, key Enter/Tab/Escape/arrows.
 *
 * Semua selector adalah string murni untuk querySelector/evaluate — tidak ada eval.
 * Aman dievaluasi ulang (executeScript recovery): pola namespace globalThis.
 */
var replayer = (globalThis.TESTERIA_REPLAYER = globalThis.TESTERIA_REPLAYER || {});
(function () {
  "use strict";

  var POLL_INTERVAL_MS = 100;
  var POLL_TIMEOUT_MS = 5000;

  // Tipe <input> yang "sejenis teks" — boleh saling menggantikan saat replay
  // (mis. text ↔ email pada form yang sama). Kontrol toggle (checkbox/radio)
  // TIDAK pernah dianggap setara dengan tipe teks.
  var TEXT_LIKE = {
    text: 1, password: 1, email: 1, number: 1, tel: 1, url: 1, search: 1,
    date: 1, time: 1, "datetime-local": 1, month: 1, week: 1
  };
  var CHECK_LIKE = { checkbox: 1, radio: 1 };

  // ---------------------------------------------------------------------------
  // Resolve elemen: kandidat + skoring sadar jenis
  // ---------------------------------------------------------------------------

  function cssAll(css) {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(css));
    } catch (e) {
      return []; // selector invalid
    }
  }

  function queryByXPath(xp) {
    try {
      var snapshot = document.evaluate(
        xp,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return snapshot.singleNodeValue;
    } catch (e) {
      return null;
    }
  }

  function inputTypeOf(el) {
    return el && el.tagName === "INPUT" ? String(el.type || "text").toLowerCase() : null;
  }

  /** Deskripsi jenis elemen untuk pesan error/panel, mis. INPUT[checkbox]. */
  function describeKindOf(el) {
    if (!el) return "?";
    var t = inputTypeOf(el);
    return t ? el.tagName + "[" + t + "]" : el.tagName;
  }

  function describeKind(kind) {
    if (!kind || !kind.tag) return "tidak diketahui";
    return kind.inputType ? kind.tag + "[" + kind.inputType + "]" : kind.tag;
  }

  /**
   * Apakah elemen `el` boleh menjadi target `step`? Ini GERBANG UTAMA anti
   * salah-pilih:
   *   - Ada `step.kind` (rekaman baru) → tag harus sama; untuk INPUT, jenis
   *     toggle harus identik (checkbox ≠ text), antar tipe teks boleh.
   *   - Tanpa kind (rekaman lama) → aturan aman per tipe step: step `input`
   *     tidak boleh mendarat di checkbox/radio/button/file/hidden; `check`
   *     wajib checkbox/radio; `select` wajib SELECT.
   */
  function kindCompatible(el, step) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    var itype = inputTypeOf(el);
    var rec = step.kind && step.kind.tag ? step.kind : null;

    if (rec) {
      if (rec.tag !== tag) return false;
      if (tag !== "INPUT") return true;
      var recT = String(rec.inputType || "text").toLowerCase();
      var recToggle = !!CHECK_LIKE[recT];
      var curToggle = !!CHECK_LIKE[itype];
      if (recToggle || curToggle) return recT === itype; // kontrol toggle wajib identik
      if (TEXT_LIKE[recT] && TEXT_LIKE[itype]) return true; // antar tipe teks
      return recT === itype;
    }

    switch (step.type) {
      case "input":
        if (tag === "TEXTAREA") return true;
        return tag === "INPUT" && !!TEXT_LIKE[itype];
      case "select":
        return tag === "SELECT";
      case "check":
        return tag === "INPUT" && !!CHECK_LIKE[itype];
      case "key":
      case "assert":
        return true;
      case "click":
        // Klik pada kontrol tersembunyi jelas bukan target rekaman; kontrol
        // lain tetap boleh (tombol/div/label/checkbox yang memang diklik user).
        return !(tag === "INPUT" && itype === "hidden");
      default:
        return true;
    }
  }

  /**
   * Kecocokan atribut identitas elemen dengan sidik jari rekaman (0..1).
   * Dipakai sebagai tie-break antar kandidat yang sama-sama jenisnya cocok.
   */
  function hintMatch(el, kind) {
    if (!kind) return 0;
    var pairs = [
      ["id", kind.id],
      ["name", kind.name],
      ["aria-label", kind.ariaLabel],
      ["placeholder", kind.placeholder]
    ];
    var n = 0;
    var hits = 0;
    for (var i = 0; i < pairs.length; i++) {
      var v = pairs[i][1];
      if (!v) continue;
      n++;
      var cur = el.getAttribute ? el.getAttribute(pairs[i][0]) : null;
      if ((cur || "") === v) hits++;
    }
    if (!n) return 0;
    return hits / n;
  }

  /** Normalisasi teks untuk perbandingan (case-insensitive, whitespace rapat). */
  function normText(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function elText(el) {
    if (!el) return "";
    var t = (el.getAttribute && el.getAttribute("aria-label")) || "";
    if (!t && el.tagName === "INPUT") t = el.placeholder || el.value || "";
    if (!t && el.tagName === "TEXTAREA") t = el.placeholder || "";
    if (!t) t = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!t) t = el.title || "";
    return normText(t);
  }

  /**
   * Filter teks kandidat. PENTING: pakai fungsi milik generator selector
   * (TESTERIA_SELECTOR.elementMatchesText) supaya normalisasi saat RECORD dan
   * saat REPLAY identik — replayer dulu punya versi teksnya sendiri, sehingga
   * kandidat teks yang dianggap unik saat merekam bisa gagal cocok saat
   * replay (salah satu sebab dropdown berhenti memilih elemen yang benar).
   */
  function matchesText(el, text) {
    if (!text) return true;
    var needle = normText(text);
    if (!needle) return true;
    var gen = globalThis.TESTERIA_SELECTOR;
    if (gen && typeof gen.elementMatchesText === "function") {
      try {
        if (gen.elementMatchesText(el, text)) return true;
      } catch (e) {}
    }
    if (elText(el) === needle) return true;
    var value = el.value != null ? normText(el.value) : "";
    return value === needle;
  }

  /**
   * BUKTI TEKS: seberapa yakin elemen ini adalah elemen yang direkam,
   * berdasarkan `step.name` (nama manusiawi hasil recorder) dan teks elemen.
   *   1   = sama persis
   *   0.5 = saling mengandung / berprefiks (friendlyName dipotong 60 char,
   *         elText 80 char — rekaman lama tetap harus cocok)
   *   0   = tidak ada bukti
   * Ini yang menolong step dropdown/portal ber-selector luas (`body div`):
   * saat rekam hanya jalur CSS yang tak unik, tapi `name` menyimpan teks
   * opsi yang benar ("gofar customer …", "In Progress").
   */
  function textEvidence(el, step) {
    var want = normText(step && step.name);
    if (!want) return 0;
    var gen = globalThis.TESTERIA_SELECTOR;
    var nm = "";
    try {
      if (gen && typeof gen.friendlyName === "function") nm = gen.friendlyName(el);
    } catch (e) {}
    var has = normText(nm) || elText(el);
    if (!has) return 0;
    if (has === want) return 1;
    if (has.length > 2 && want.length > 2 && (has.indexOf(want) === 0 || want.indexOf(has) === 0)) {
      return 0.5;
    }
    if (
      has.length >= 4 &&
      want.length >= 4 &&
      (has.indexOf(want) !== -1 || want.indexOf(has) !== -1)
    ) {
      return 0.5;
    }
    return 0;
  }

  /**
   * Apakah user sudah meminta step yang sedang dieksekusi ini dibatalkan
   * (Stop/Skip ditekan di panel)? Disediakan main.js lewat global; keyed per
   * nomor step supaya pesan abort yang telat tidak mematikan step berikutnya.
   */
  function abortRequested() {
    try {
      return (
        typeof globalThis.TESTERIA_ABORT_REQUESTED === "function" &&
        globalThis.TESTERIA_ABORT_REQUESTED() === true
      );
    } catch (e) {
      return false;
    }
  }

  function collectTried(sel) {
    if (!sel || typeof sel !== "object") return "(tanpa selector)";
    var parts = [];
    if (sel.css) parts.push(sel.css + (sel.text ? ' [teks="' + sel.text + '"]' : ""));
    if (sel.alt && sel.alt.length) {
      for (var i = 0; i < sel.alt.length; i++) {
        var c = sel.alt[i];
        if (c && c.css) parts.push(c.css + (c.text ? ' [teks="' + c.text + '"]' : ""));
      }
    }
    if (sel.xpath) parts.push("xpath: " + sel.xpath);
    return parts.length ? parts.join(", ") : "(tanpa selector)";
  }

  /**
   * Kumpulkan SEMUA elemen yang cocok dengan kandidat selector (bukan hanya
   * yang pertama), sekaligus mencatat SEBERAPA SPESIFIK sumbernya:
   *   srcTotal = jumlah node yang cocok dengan css mentah (tanpa filter teks)
   *   srcKeep  = jumlah node yang lolos filter teks sumber itu
   * Sumber yang menyempit jadi 1 elemen jauh lebih dapat dipercaya daripada
   * `body div` yang cocok ratusan node — dulu informasi ini dibuang, sehingga
   * "div pertama yang visible" bisa menang dan step dilaporkan sukses padahal
   * mengklik elemen yang sama sekali lain.
   */
  function gatherCandidates(sel) {
    var out = [];
    if (!sel || typeof sel !== "object") return out;
    function addAll(css, text, how) {
      var nodes = cssAll(css);
      if (!nodes.length) return;
      var keep = [];
      for (var i = 0; i < nodes.length; i++) {
        if (text && nodes.length > 1 && !matchesText(nodes[i], text)) continue;
        keep.push(nodes[i]);
      }
      for (var k = 0; k < keep.length; k++) {
        out.push({
          el: keep[k],
          how: how,
          srcTotal: nodes.length,
          srcKeep: keep.length,
          order: out.length
        });
      }
    }
    if (sel.css) addAll(sel.css, sel.text, "css");
    if (sel.alt && sel.alt.length) {
      for (var a = 0; a < sel.alt.length; a++) {
        var cand = sel.alt[a];
        if (cand && cand.css) addAll(cand.css, cand.text, "alt");
      }
    }
    if (sel.xpath) {
      var xp = queryByXPath(sel.xpath);
      if (xp) out.push({ el: xp, how: "xpath", srcTotal: 1, srcKeep: 1, order: out.length });
    }
    return out;
  }

  // Bobot skor kandidat (lihat pickCandidate).
  var SCORE_TEXT = 100; // bukti teks dari step.name — paling menentukan
  var SCORE_SPECIFIC = 40; // sumber selector menyempit jadi tepat 1 elemen
  var SCORE_HINT = 10; // sidik jari (id/name/aria-label/placeholder) cocok

  /**
   * Pilih kandidat terbaik: bukti teks → kespesifikan sumber → sidik jari →
   * visible → urutan kandidat.
   *
   * Kandidat hidden dibuang lebih dulu bila ADA kandidat visible (dulu
   * kandidat hidden ber-skor tinggi bisa "menang" lalu seluruh step gagal
   * padahal elemen yang benar ada dan terlihat).
   *
   * Bila step ini PUNYA nama manusiawi (petunjuk teks) tapi TIDAK ada
   * kandidat yang cocok dengannya, sementara selector utamanya sendiri luas
   * (`body div` pada rekaman dropdown portal) — step TIDAK dieksekusi:
   * mengklik "div visible pertama" adalah persis cara salah-pilih elemen yang
   * membuat dropdown memilih opsi salah lalu merusak seluruh step berikutnya.
   * Lebih baik gagal eksplisit + tawarkan Skip.
   *
   * Step TANPA nama (rekaman lama) tetap memakai perilaku lama — kandidat
   * visible pertama yang jenisnya cocok — supaya rekaman yang sudah berjalan
   * tidak mendadak gagal hanya karena selector lamanya luas.
   *
   * Return { found, el, how } atau { found:false, ...alasan }.
   */
  function pickCandidate(cands, step, needVisible) {
    var compatible = [];
    var visible = [];
    var rejectedKind = 0;
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c.el || !c.el.isConnected) continue;
      if (!kindCompatible(c.el, step)) {
        rejectedKind++;
        continue;
      }
      compatible.push(c);
      if (isVisible(c.el)) visible.push(c);
    }
    if (!compatible.length) {
      return { found: false, sawCandidate: cands.length > 0, rejectedKind: rejectedKind };
    }
    var pool = visible.length ? visible : compatible;
    var best = null;
    var bestScore = -Infinity;
    for (var j = 0; j < pool.length; j++) {
      var cc = pool[j];
      var score =
        textEvidence(cc.el, step) * SCORE_TEXT +
        (cc.srcTotal === 1 ? SCORE_SPECIFIC : 0) +
        hintMatch(cc.el, step.kind) * SCORE_HINT -
        cc.order * 0.01;
      if (score > bestScore) {
        bestScore = score;
        best = cc;
      }
    }
    if (!best) {
      return { found: false, sawCandidate: cands.length > 0, rejectedKind: rejectedKind };
    }
    if (needVisible && !visible.length) {
      // Kontrol native tersembunyi (custom checkbox/radio yang digerakkan via
      // <label>) masih boleh diklik ASAL sidik jarinya cocok dengan rekaman.
      var fpOk = step.type === "check" && step.kind && hintMatch(best.el, step.kind) > 0;
      if (!fpOk) {
        return { found: false, sawCandidate: true, hiddenEl: best.el, rejectedKind: rejectedKind };
      }
    }
    // Guard ambigu (lihat doc komentar di atas). Syarat: step PUNYA nama,
    // nama itu tidak cocok dengan kandidat mana pun, selector UTAMA (sumber
    // pertama — biasanya sel.css) sendiri tidak menyempit, dan masih ada >1
    // kandidat visible yang jenisnya cocok — tidak ada dasar untuk memilih satu.
    var primaryBroad = cands.length > 0 && cands[0].srcKeep > 1;
    if (
      needVisible &&
      visible.length > 1 &&
      primaryBroad &&
      normText(step.name) !== "" &&
      textEvidence(best.el, step) === 0 &&
      hintMatch(best.el, step.kind) === 0
    ) {
      return {
        found: false,
        sawCandidate: true,
        ambiguous: true,
        ambiguousCount: visible.length,
        rejectedKind: rejectedKind
      };
    }
    return { found: true, el: best.el, how: best.how };
  }

  function failureMessage(step, timeoutMs, kindMismatch, hiddenEl, ambiguousCount) {
    var secs = Math.round((timeoutMs || POLL_TIMEOUT_MS) / 1000);
    if (kindMismatch) {
      return (
        "kandidat selector cocok tapi JENIS elemen berbeda dari rekaman (" +
        describeKind(step.kind) +
        ") — step TIDAK dieksekusi supaya tidak salah pilih. Pakai tombol Skip bila field ini memang tidak ada di kondisi sekarang. (selector dicoba: " +
        collectTried(step.selector) +
        ")"
      );
    }
    if (hiddenEl) {
      return (
        "element ditemukan (" + describeKindOf(hiddenEl) + ") tapi tetap tidak visible setelah " +
        secs + " detik — mungkin di dalam menu tertutup, tab tidak aktif, atau field kondisional disembunyikan. Pakai tombol Skip untuk melewatinya."
      );
    }
    if (ambiguousCount) {
      return (
        "selector rekaman terlalu luas DAN nama step tidak cocok dengan elemen mana pun: " +
        ambiguousCount +
        " elemen jenis " +
        describeKind(step.kind) +
        " cocok dan semuanya visible (" +
        collectTried(step.selector) +
        "). Target step ini mungkin belum tampil (mis. dropdown belum terbuka) atau teksnya berubah. Step TIDAK dieksekusi supaya tidak salah klik — pakai tombol Skip, atau rekam ulang step ini. Nama step: " +
        (step.name ? '"' + String(step.name).slice(0, 40) + '".' : "(tanpa nama).")
      );
    }
    return (
      "element tidak ketemu setelah " + secs + " detik (selector dicoba: " +
      collectTried(step.selector) +
      (step.kind ? " | rekaman: " + describeKind(step.kind) : "") +
      "). Pakai tombol Skip untuk melewatinya."
    );
  }

  /**
   * Resolve elemen untuk step dengan polling. Return { el, how } atau
   * { failure: "pesan" }. `timeoutMs` opsional (default 5 dtk).
   */
  async function resolveForStep(step, timeoutMs) {
    var limit = typeof timeoutMs === "number" ? timeoutMs : POLL_TIMEOUT_MS;
    var started = Date.now();
    var kindMismatch = false;
    var hiddenEl = null;
    var ambiguousCount = 0;
    while (true) {
      // Stop/Skip ditekan saat step ini sedang mencari elemen → berhenti
      // mencari. Tanpa ini, elemen yang baru muncul setelah user menekan Stop
      // tetap diklik ("stop kok masih jalan").
      if (abortRequested()) return { aborted: true, failure: "dibatalkan user" };
      var cands = gatherCandidates(step.selector);
      if (cands.length) {
        var res = pickCandidate(cands, step, step.type !== "assert");
        if (res.found) return { el: res.el, how: res.how };
        if (res.hiddenEl) hiddenEl = res.hiddenEl;
        else if (res.rejectedKind) kindMismatch = true;
        ambiguousCount = res.ambiguous ? res.ambiguousCount || 1 : 0;
      }
      if (Date.now() - started >= limit) {
        return {
          failure: failureMessage(step, limit, kindMismatch, hiddenEl, ambiguousCount)
        };
      }
      await new Promise(function (r) {
        setTimeout(r, POLL_INTERVAL_MS);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Visibility + interaksi
  // ---------------------------------------------------------------------------

  function isVisible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var st = window.getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none";
  }

  function ensureVisible(el) {
    try {
      el.scrollIntoView({ block: "center", behavior: "instant" });
    } catch (e) {
      try {
        el.scrollIntoView(true);
      } catch (e2) {}
    }
  }

  // Titik tengah elemen (dipakai kursor virtual & event klik).
  function centerOf(el) {
    var rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    return {
      x: rect.left + (rect.width || 0) / 2,
      y: rect.top + (rect.height || 0) / 2
    };
  }

  /** Kursor virtual di halaman (bila aktif); tanpa efek bila belum aktif. */
  function vc() {
    return globalThis.TESTERIA_OVERLAY || null;
  }

  /** Gerakkan kursor virtual ke elemen (bila aktif). Jejak mouse terekam
   * (`path`) sudah tidak dipakai — glide langsung from→to. */
  async function vcMoveToEl(el, label) {
    var ov = vc();
    if (ov && typeof ov.vcMoveTo === "function") {
      var c = centerOf(el);
      try {
        await ov.vcMoveTo(c.x, c.y, label || "");
      } catch (e) {}
    }
  }

  function vcClickFx() {
    var ov = vc();
    if (ov && typeof ov.vcClick === "function") {
      try {
        ov.vcClick();
      } catch (e) {}
    }
  }

  function abortedResult() {
    return { ok: false, aborted: true, error: "dibatalkan user (Stop/Skip)" };
  }

  /**
   * Setelah animasi kursor, PASTIKAN elemen masih hidup dan masih jenis yang
   * benar. Saat aplikasi merender ulang (form kondisional!) node lama bisa
   * diganti/detach selama glide — mengeksekusi node mati = step "sukses" tapi
   * tidak terjadi apa-apa, lalu step berikutnya meleset. Bila lepas: resolve
   * ulang + glide ulang (maks 2 percobaan), atau kembalikan null → gagal
   * eksplisit (tidak pernah salah eksekusi).
   */
  async function settleTarget(el, step, label) {
    await vcMoveToEl(el, label);
    if (el.isConnected && kindCompatible(el, step)) return el;
    for (var i = 0; i < 2; i++) {
      var re = await resolveForStep(step, 1500);
      if (!re || !re.el) return null;
      ensureVisible(re.el);
      await vcMoveToEl(re.el, label);
      if (re.el.isConnected && kindCompatible(re.el, step)) return re.el;
      el = re.el;
    }
    return null;
  }

  /** Nama manusiawi elemen (untuk upgrade label step rekaman lama). */
  function nameOf(el) {
    try {
      var gen = globalThis.TESTERIA_SELECTOR;
      return gen && gen.friendlyName ? gen.friendlyName(el) : "";
    } catch (e) {
      return "";
    }
  }

  function synthesizeClick(el, opts) {
    opts = opts || {};
    var rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    var init = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: opts.button === "right" ? 2 : 0,
      buttons: opts.button === "right" ? 2 : 0,
      clientX: rect.left + (rect.width || 0) / 2,
      clientY: rect.top + (rect.height || 0) / 2
    };
    if (opts.dblclick) {
      // Urutan lengkap dblclick (beberapa komponen merespons pointer/mousedown).
      el.dispatchEvent(new PointerEvent("pointerdown", init));
      el.dispatchEvent(new MouseEvent("mousedown", init));
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      el.dispatchEvent(new MouseEvent("dblclick", init));
      return;
    }
    if (opts.button === "right") {
      el.dispatchEvent(new PointerEvent("pointerdown", init));
      el.dispatchEvent(new MouseEvent("mousedown", init));
      el.dispatchEvent(new MouseEvent("contextmenu", init));
      el.dispatchEvent(new PointerEvent("pointerup", init));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      return;
    }
    // Urutan lengkap klik kiri. PENTING: mousedown/pointerdown wajib ikut
    // di-dispatch — react-select (dan banyak dropdown lain) membuka menu di
    // mousedown, bukan di click.
    el.dispatchEvent(new PointerEvent("pointerdown", init));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    el.dispatchEvent(new PointerEvent("pointerup", init));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    el.dispatchEvent(new MouseEvent("click", init));
  }

  function dispatchKey(el, key) {
    var init = { key: key, bubbles: true, cancelable: true };
    var target = el || document.activeElement || document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // ---------------------------------------------------------------------------
  // Native value setter + event dispatch (kunci kompatibilitas framework)
  // ---------------------------------------------------------------------------

  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  var nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  ).set;

  function dispatchValueEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Set nilai input/textarea lewat setter native lalu dispatch input+change.
   * Return { ok } atau { ok: false, error } bila nilai ternyata ditolak
   * (mis. input[type=number] menerima teks non-numerik → value tersanitasi).
   */
  function setInputValue(el, value) {
    try {
      if (el.tagName === "TEXTAREA") {
        nativeTextareaValueSetter.call(el, value);
      } else {
        nativeInputValueSetter.call(el, value);
      }
    } catch (e) {
      el.value = value;
    }
    if (String(el.value) !== String(value)) {
      return {
        ok: false,
        error:
          'nilai tidak bisa di-set (value sekarang: "' +
          String(el.value).slice(0, 40) +
          '")'
      };
    }
    dispatchValueEvents(el);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  /**
   * Eksekusi step ASSERTION: verifikasi kondisi elemen TANPA mengubah
   * halaman. Mode (recorder menurunkannya dari jenis elemen):
   *   text   → innerText mengandung `value` (case-insensitive)
   *   value  → nilai input/textarea/select === `value` (step masked =
   *            password: cukup pastikan field TERISI — nilai asli tak disimpan)
   *   checked→ checkbox/radio dalam keadaan `value` ("checked"/"unchecked")
   *   visible→ elemen ada dan terlihat
   * Element di-polling sampai kondisi terpenuhi / timeout — assertion yang
   * menunggu render lambat TETAP lolos, assertion yang salah GAGAL eksplisit
   * dengan expected/actual (bukan error element-hilang yang menyesatkan).
   * Return { ok: true, assertPass: true } atau { ok: false, error }.
   */
  replayer.executeAssertion = async function (step) {
    var mode = step.assertMode || "text";
    var expected = step.value == null ? "" : String(step.value);
    var started = Date.now();
    var lastFailure = null;
    while (true) {
      // Abort di tengah assertion: user menekan Stop/Skip — jangan tunggu
      // sampai timeout hanya untuk melaporkan hasil yang sudah tidak diminati.
      if (abortRequested()) return abortedResult();
      var resolved = await resolveForStep(step, 250);
      if (resolved && resolved.aborted) return abortedResult();
      if (resolved && resolved.el) {
        var el = resolved.el;
        var actual = null;
        var pass = false;
        if (mode === "visible") {
          pass = isVisible(el);
          actual = pass ? "visible" : "hidden";
        } else if (mode === "value") {
          actual = el.value == null ? "" : String(el.value);
          if (step.masked) {
            // Password: nilai asli tidak pernah disimpan ("<masked>") —
            // satu-satunya semantik yang masuk akal: field harus TERISI.
            pass = actual.length > 0;
            expected = "***";
          } else {
            pass = actual === expected;
          }
        } else if (mode === "checked") {
          actual = el.checked ? "checked" : "unchecked";
          pass = actual === expected;
        } else {
          // text: innerText mengandung expected (case-insensitive, whitespace
          // dinormalisasi — markup multi-baris tidak boleh menggagalkan).
          actual = String(el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          pass = actual.toLowerCase().indexOf(expected.toLowerCase()) !== -1;
        }
        if (pass) return { ok: true, assertPass: true, name: nameOf(el) };
        lastFailure =
          "assertion gagal (mode " + mode + "): diharapkan '" +
          String(expected).slice(0, 60) +
          "', aktual '" +
          String(actual).slice(0, 60) + "'";
      } else if (resolved && resolved.failure) {
        lastFailure = "assertion gagal: " + resolved.failure;
      }
      if (Date.now() - started >= POLL_TIMEOUT_MS) {
        return {
          ok: false,
          error:
            lastFailure ||
            "assertion gagal: element tidak ketemu setelah " +
              POLL_TIMEOUT_MS / 1000 +
              " detik (selector dicoba: " +
              collectTried(step.selector) + ")"
        };
      }
      await new Promise(function (r) {
        setTimeout(r, POLL_INTERVAL_MS);
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Eksekusi step
  // ---------------------------------------------------------------------------

  /**
   * Eksekusi satu step. Resolve { ok: true } atau { ok: false, error }.
   * Untuk step input bertanda masked (password): resolve { ok: true,
   * needPassword: true } — pemanggil (main.js) menampilkan prompt lalu
   * mengisi lewat replayer.fillInput().
   */
  replayer.executeStep = async function (step) {
    if (!step || typeof step.type !== "string") {
      return { ok: false, error: "step tidak valid" };
    }

    // Penanda ganti dokumen TANPA URL: tidak ada aksi di halaman — background
    // (driver) yang menunggu PAGE_READY dokumen berikutnya. Step navigate
    // warisan diperlakukan sama: URL tidak pernah dieksekusi.
    if (step.type === "pageload" || step.type === "navigate") {
      return { ok: true, pageMarker: true };
    }

    // ----------------------------- assert -----------------------------
    // Assertion DIKENDALIKAN SEBELUM blok visible-poll: mode "visible"
    // justru MENGHARAPKAN elemen hidden (mis. spinner hilang) — polling
    // "harus visible" di bawah akan menggagalkannya sebelum sempat dicek.
    if (step.type === "assert") {
      return replayer.executeAssertion(step);
    }

    // ------------------------------- key --------------------------------
    if (step.type === "key") {
      var kt = null;
      if (step.selector) {
        kt = await resolveForStep({ type: "key", selector: step.selector, kind: step.kind }, POLL_TIMEOUT_MS);
        if (kt && kt.aborted) return abortedResult();
        if (!kt || !kt.el) {
          return { ok: false, error: kt && kt.failure ? kt.failure : "element tidak ketemu" };
        }
      }
      var keyEl = kt && kt.el ? kt.el : null;
      if (keyEl) {
        ensureVisible(keyEl);
        try {
          keyEl.focus();
        } catch (e) {}
      }
      dispatchKey(keyEl, step.value);
      return { ok: true, name: keyEl ? nameOf(keyEl) : "" };
    }

    // ------------------- click / input / select / check ------------------
    // Elemen harus ada, JENISNYA COCOK dengan rekaman, dan visible. Yang baru
    // ada di DOM tapi masih hidden (delayed reveal / animasi masuk) TIDAK
    // langsung gagal — polling diteruskan sampai visible atau timeout.
    var resolved = await resolveForStep(step, POLL_TIMEOUT_MS);
    if (resolved && resolved.aborted) return abortedResult();
    if (!resolved || !resolved.el) {
      return {
        ok: false,
        error: resolved && resolved.failure ? resolved.failure : "element tidak ketemu"
      };
    }
    var el = resolved.el;
    ensureVisible(el);

    switch (step.type) {
      case "click": {
        var label = step.dblclick ? "dblclick" : step.button === "right" ? "klik kanan" : "klik";
        var live = await settleTarget(el, step, label);
        if (abortRequested()) return abortedResult();
        if (!live) {
          return {
            ok: false,
            error:
              "elemen berubah/terlepas saat animasi kursor (halaman merender ulang) — step tidak dieksekusi supaya tidak salah klik. Pakai Ulangi/Skip."
          };
        }
        if (typeof live.focus === "function") {
          try {
            live.focus();
          } catch (e) {}
        }
        vcClickFx();
        synthesizeClick(live, { dblclick: !!step.dblclick, button: step.button });
        return { ok: true, name: nameOf(live) };
      }

      case "input": {
        if (step.masked) return { ok: true, needPassword: true };
        var tag = el.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          return { ok: false, error: "target bukan input/textarea (" + describeKindOf(el) + ")" };
        }
        var liveInput = await settleTarget(el, step, "ketik");
        if (!liveInput) {
          return {
            ok: false,
            error:
              "elemen berubah/terlepas saat animasi kursor (halaman merender ulang) — step tidak dieksekusi supaya tidak salah isi. Pakai Ulangi/Skip."
          };
        }
        var set = setInputValue(liveInput, String(step.value == null ? "" : step.value));
        if (!set.ok) return set;
        return { ok: true, name: nameOf(liveInput) };
      }

      case "select": {
        if (el.tagName !== "SELECT") {
          return { ok: false, error: "target bukan SELECT (" + describeKindOf(el) + ")" };
        }
        var liveSel = await settleTarget(el, step, "pilih");
        if (!liveSel) {
          return {
            ok: false,
            error:
              "elemen berubah/terlepas saat animasi kursor (halaman merender ulang) — step tidak dieksekusi supaya tidak salah pilih. Pakai Ulangi/Skip."
          };
        }
        var opt = null;
        if (abortRequested()) return abortedResult();
        for (var i = 0; i < liveSel.options.length; i++) {
          if (liveSel.options[i].value === step.value || liveSel.options[i].text === step.value) {
            opt = liveSel.options[i];
            break;
          }
        }
        if (!opt) {
          return {
            ok: false,
            error: 'option "' + step.value + '" tidak ada di <select>'
          };
        }
        liveSel.value = opt.value;
        vcClickFx();
        dispatchValueEvents(liveSel);
        return { ok: true, name: nameOf(liveSel) };
      }

      case "check": {
        var checkable =
          el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
        if (!checkable) {
          return { ok: false, error: "target bukan checkbox/radio (" + describeKindOf(el) + ")" };
        }
        var liveChk = await settleTarget(el, step, "centang");
        if (!liveChk) {
          return {
            ok: false,
            error:
              "elemen berubah/terlepas saat animasi kursor (halaman merender ulang) — step tidak dieksekusi supaya tidak salah centang. Pakai Ulangi/Skip."
          };
        }
        var want = step.value === "checked";
        if (abortRequested()) return abortedResult();
        if (liveChk.checked !== want) {
          vcClickFx();
          liveChk.click(); // toggle native → event input/change ikut terpicu browser
          if (liveChk.checked !== want) {
            try {
              liveChk.checked = want;
              dispatchValueEvents(liveChk);
            } catch (e) {}
          }
          if (liveChk.checked !== want) {
            return { ok: false, error: "gagal mengubah checked" };
          }
        }
        return { ok: true, name: nameOf(liveChk) };
      }

      default:
        // "assert" tidak pernah sampai sini — ditangani sebelum blok polling.
        return { ok: false, error: "tipe step tidak dikenal: " + step.type };
    }
  };

  /**
   * Isi input/textarea setelah prompt password manual (nilai sekali pakai,
   * tidak pernah disimpan ke storage).
   */
  replayer.fillInput = async function (selectorObj, value) {
    var resolved = await resolveForStep(
      { type: "input", selector: selectorObj, kind: null },
      POLL_TIMEOUT_MS
    );
    if (!resolved || !resolved.el) {
      return {
        ok: false,
        error: resolved && resolved.failure ? resolved.failure : "element password tidak ketemu"
      };
    }
    var el = resolved.el;
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") {
      return { ok: false, error: "target bukan input/textarea" };
    }
    return setInputValue(el, String(value));
  };
})();
