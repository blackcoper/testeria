/*
 * Testeria — background/background.js
 *
 * Event page (Firefox/Safari: background.scripts) SEKALIGUS service worker (Chrome).
 * Karena itu file ini WAJIB bebas DOM API: tanpa `window`, tanpa `Blob`, tanpa
 * `document` — hanya WebExtension APIs + timer.
 *
 * Semua state yang harus bertahan disimpan di browser.storage.local (session),
 * BUKAN di variabel modul — background bisa di-unload kapan saja dan nanti
 * dibangkitkan ulang oleh event berikutnya.
 *
 * Service worker Chrome meng-importScripts("shared/util.js") di baris pertama.
 * (Event page Firefox mendapatkannya dari manifest.background.scripts.)
 */
if (typeof importScripts === "function") {
  /* eslint-disable-next-line no-undef */
  // PENTING: path HARUS absolut ("/shared/util.js"). Path relatif di-resolve
  // terhadap URL worker (…/background/background.js) → …/background/shared/
  // util.js 404 → importScripts melempar error → SELURUH background mati
  // diam-diam di Chrome MV3 (semua runtime.sendMessage manggut tanpa jawaban).
  importScripts("/shared/util.js");
}

var bg = (globalThis.TESTERIA_BG = globalThis.TESTERIA_BG || {});
(function () {
  "use strict";

  var api = globalThis.browser;
  var T = globalThis.TESTERIA;

  // ---------------------------------------------------------------------------
  // Badge
  // ---------------------------------------------------------------------------
  bg.setRecBadge = async function (on) {
    try {
      await api.action.setBadgeText({ text: on ? "REC" : "" });
      if (on) {
        await api.action.setBadgeBackgroundColor({ color: "#d93025" });
      }
    } catch (e) {
      /* badge bisa gagal tanpa tab; tidak fatal */
    }
  };

  // ---------------------------------------------------------------------------
  // Record lifecycle
  // ---------------------------------------------------------------------------

  /** Cek cepat: content script Testeria sudah hidup di tab ini? */
  async function contentAlive(tabId) {
    try {
      const res = await api.tabs.sendMessage(tabId, { type: "TESTERIA_PING" });
      return !!(res && res.ok);
    } catch (e) {
      return false;
    }
  }

  var CONTENT_FILES = [
    "shared/util.js",
    "content/overlay.js",
    "content/selector.js",
    "content/recorder.js",
    "content/replayer.js",
    "content/main.js"
  ];

  /** Inject content script (idempoten — tiap file punya guard anti-double). */
  async function injectContentScripts(tabId) {
    await api.scripting.executeScript({
      target: { tabId: tabId, allFrames: false },
      files: CONTENT_FILES
    });
  }

  /**
   * Tanya identitas dokumen ke content script: docToken (dokumen unik), URL,
   * dan readyState. Dipakai mode reuse tab (tab yang sudah terbuka tidak akan
   * mengirim PAGE_READY baru) dan penanda `pageload` (sudah pindah dokumen?).
   */
  bg.whoami = async function (tabId) {
    try {
      var res = await api.tabs.sendMessage(tabId, { type: "TESTERIA_WHOAMI" });
      if (res && res.ok && typeof res.docToken === "string") return res;
      return null;
    } catch (e) {
      return null;
    }
  };

  /**
   * Apakah tab sedang berganti dokumen (navigasi/reload penuh)? Dipakai untuk
   * membedakan "content script mati karena dokumen dibongkar" dari "injection
   * gagal": pada kasus pertama driver parkir & menunggu PAGE_READY, bukan gagal.
   */
  async function tabIsTurning(tabId) {
    try {
      var s = await T.getSession();
      var known = s.replay && typeof s.replay.docUrl === "string" ? s.replay.docUrl : null;
      var tab = await api.tabs.get(tabId);
      if (!tab) return false;
      if (tab.status === "loading") return true;
      if (known && typeof tab.url === "string" && tab.url !== known) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Cari tab yang bisa dipakai ulang untuk replay: origin SAMA dengan
   * startUrl recording (utamakan tab aktif). Tanpa ini replay selalu membuka
   * tab baru padahal user sudah berada di aplikasi yang sama.
   */
  async function findReuseTab(startUrl) {
    var origin;
    try {
      origin = new URL(startUrl).origin;
    } catch (e) {
      return null;
    }
    var tabs = [];
    try {
      tabs = await api.tabs.query({});
    } catch (e) {
      return null;
    }
    var activeId = null;
    try {
      var act = await api.tabs.query({ active: true, lastFocusedWindow: true });
      if (act && act[0]) activeId = act[0].id;
    } catch (e) {
      try {
        var act2 = await api.tabs.query({ active: true, currentWindow: true });
        if (act2 && act2[0]) activeId = act2[0].id;
      } catch (e2) {}
    }
    var candidates = [];
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      if (!t || typeof t.id !== "number" || !T.isRecordableUrl(t.url)) continue;
      var same = false;
      try {
        same = new URL(t.url).origin === origin;
      } catch (e) {
        same = false;
      }
      if (same) candidates.push(t);
    }
    if (!candidates.length) return null;
    for (var j = 0; j < candidates.length; j++) {
      if (candidates[j].id === activeId) return candidates[j];
    }
    return candidates[0];
  }

  /**
   * Migrasi data sekali jalan: step `navigate{url}` → penanda tanpa URL
   * `pageload`, dan `url` dihapus dari semua step. Rekaman lama berhenti
   * memaksa URL/id lama saat replay.
   */
  bg.migrateRecordings = async function () {
    var recordings = await T.getRecordings();
    if (T.recordingsNeedMigration(recordings)) {
      await T.setRecordings(T.migrateRecordings(recordings));
      await api.storage.local.set({ stepSchema: T.STEP_SCHEMA_VERSION });
      return { ok: true, migrated: recordings.length };
    }
    await api.storage.local.set({ stepSchema: T.STEP_SCHEMA_VERSION });
    return { ok: true, migrated: 0 };
  };

  /** Mulai recording di tab tertentu. */
  bg.startRecording = async function (tabId, url) {
    var session = await T.getSession();
    if (session.recording) return { ok: false, error: "already-recording" };

    session.recording = true;
    session.recordingTabId = tabId;
    session.pendingSteps = [];
    session.startUrl = T.isRecordableUrl(url) ? url : null;
    // URL dokumen terakhir (transien, TIDAK masuk step) — untuk mendeteksi
    // ganti dokumen penuh tanpa menyimpan URL di dalam step.
    session.lastDocUrl = session.startUrl;
    session.startedAt = T.now();
    // CATATAN: lastToggleFromContent TIDAK di-reset di sini — guard anti
    // double-fire harus tetap aktif tepat setelah start (event commands dan
    // keydown content bisa datang beruntunan saat toggle yang sama).
    session.replay = null;
    await T.setSession(session);
    await bg.setRecBadge(true);
    return { ok: true };
  };

  /**
   * Stop recording: mematikan flag + badge, dan mengembalikan step terkumpul
   * agar pemanggil bisa menampilkannya di modal Save/Discard.
   */
  bg.stopRecording = async function () {
    var session = await T.getSession();
    var had = session.recording;
    session.recording = false;
    await T.setSession(session);
    await bg.setRecBadge(false);
    return { ok: true, wasRecording: had, steps: session.pendingSteps || [], startUrl: session.startUrl };
  };

  /** Append satu step ke buffer (dipanggil dari content script). */
  bg.appendStep = async function (step) {
    var session = await T.getSession();
    if (!session.recording) return { ok: false, error: "not-recording" };
    session.pendingSteps = session.pendingSteps || [];
    session.pendingSteps.push(step);
    await T.setSession(session);
    return { ok: true, count: session.pendingSteps.length };
  };

  /** Simpan recording hasil stop sebagai entri baru di recordings. */
  bg.saveRecording = async function (name, steps, startUrl) {
    var cleanName = String(name || "").trim();
    if (!cleanName) return { ok: false, error: "empty-name" };
    var recordings = await T.getRecordings();
    var rec = {
      id: T.makeId(),
      name: cleanName,
      createdAt: T.now(),
      startUrl: T.isRecordableUrl(startUrl) ? startUrl : null,
      group: null, // organisasi Proyek/Modul diatur dari popup (tombol Grup)
      steps: Array.isArray(steps) ? steps : []
    };
    recordings.unshift(rec);
    await T.setRecordings(recordings);

    // Bersihkan buffer session setelah tersimpan.
    var session = await T.getSession();
    session.pendingSteps = [];
    session.recordingTabId = null;
    await T.setSession(session);

    return { ok: true, recording: rec };
  };

  /** Buang buffer hasil stop (Discard). */
  bg.discardRecording = async function () {
    var session = await T.getSession();
    session.pendingSteps = [];
    session.recordingTabId = null;
    await T.setSession(session);
    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Toggle recording (dari commands ATAU content keydown) + guard double-fire
  // ---------------------------------------------------------------------------

  /**
   * Guard anti double-toggle: onCommand dan keydown content bisa datang
   * hampir bersamaan untuk satu penekanan tombol. Toggle kedua dalam 500 ms
   * diabaikan. Timestamp disimpan di session (storage), bukan variabel memory.
   */
  bg.toggleRecording = async function (source, tabId, url) {
    var session = await T.getSession();
    var now = T.now();
    if (now - (session.lastToggleFromContent || 0) < 500) {
      return { ok: false, error: "debounced" };
    }
    session.lastToggleFromContent = now;

    if (session.recording) {
      // Kalau yang toggle bukan dari tab recording, tetap stop global.
      // Persistenkan dulu guard timestamp (stopRecording membaca ulang storage).
      await T.setSession(session);
      var res = await bg.stopRecording();
      return { ok: true, action: "stopped", steps: res.steps, startUrl: res.startUrl, tabId: session.recordingTabId || tabId };
    }

    // Mulai: butuh tab aktif yang recordable.
    var target = null;
    if (typeof tabId === "number") {
      try {
        target = await api.tabs.get(tabId);
      } catch (e) {
        target = null;
      }
    }
    if (!target) {
      var tabs = await api.tabs.query({ active: true, currentWindow: true });
      target = tabs && tabs[0];
    }
    if (!target || !T.isRecordableUrl(target.url)) {
      await T.setSession(session);
      return { ok: false, error: "no-recordable-tab" };
    }

    await T.setSession(session); // simpan timestamp guard dulu
    var start = await bg.startRecording(target.id, target.url);
    if (!start.ok) return start;

    // Pastikan content script hidup di tab target — PING dulu, inject hanya
    // bila tak ada jawaban. Re-inject buta menyebabkan listener ganda (state
    // modul IIFE ikut ter-reset) meski tiap file punya guard.
    if (!(await contentAlive(target.id))) {
      try {
        await injectContentScripts(target.id);
      } catch (e) {
        /* Halaman yang melarang injection (mis. web store) — recording tetap
           aktif; content script akan ikut saat navigasi berikutnya. */
      }
    }

    // Sinkronkan state ke content script tab target (REC dot).
    bg.pushRecordingState(target.id).catch(function () {});
    return { ok: true, action: "started", tabId: target.id };
  };

  /** Kirim state recording terkini ke sebuah tab (best-effort). */
  bg.pushRecordingState = async function (tabId) {
    var session = await T.getSession();
    var active = session.recording && session.recordingTabId === tabId;
    return api.tabs.sendMessage(tabId, {
      type: "TESTERIA_REC_STATE",
      recording: !!active
    });
  };

  // ---------------------------------------------------------------------------
  // Replay driver (jalan di background agar bertahan meski popup ditutup)
  // ---------------------------------------------------------------------------

  var replayDriverActive = false; // mutex: PAGE_READY bisa datang ganda saat recovery inject
  var replayDriverIndex = -1; // step yang sedang dikerjakan driver (koordinasi pause/skip)

  /** True bila driver replay sedang hidup (termasuk tidur menunggu delayMs). */
  bg.replayDriverBusy = function () {
    return replayDriverActive;
  };

  /**
   * Beri tahu content script tab replay bahwa step yang sedang dieksekusi
   * harus DIBATALKAN (Stop/Skip/Pause ditekan user). Keyed ke nomor step
   * in-flight (1-based): pesan abort yang telat datang tidak boleh mematikan
   * step berikutnya. Tanpa ini, elemen yang baru muncul setelah user menekan
   * Stop tetap diklik — "Stop kok masih jalan".
   */
  bg.abortInFlight = function (tabId) {
    if (!tabId || replayDriverIndex < 0) return;
    api.tabs
      .sendMessage(tabId, {
        type: "TESTERIA_REPLAY_ABORT",
        stepNumber: replayDriverIndex + 1
      })
      .catch(function () {});
  };

  /**
   * Semua read-modify-write state replay diserialisasi dalam SATU antrean.
   * Driver replay berjalan di luar antrean pesan (fire-and-forget dari
   * handler), jadi dua penulis bisa saling menimpa: penulis yang membaca
   * session lebih dulu lalu menulis belakangan menimpa keadaan yang lebih
   * baru — pernah menghasilkan "replay hantu" `{status:"running"}` yang
   * menimpa state replay baru lengkap dengan total/labels.
   */
  var stateQueue = Promise.resolve();
  function serializeState(fn) {
    var run = stateQueue.then(fn, fn);
    stateQueue = run.then(
      function () {},
      function () {}
    );
    return run;
  }

  /**
   * Tulis (patch) state replay. HANYA patch yang meng-INISIALISASI replay
   * (punya recordingId — lihat bg.startReplay) yang boleh MEMBUAT objek replay
   * baru. Tanpa aturan ini, penulis yang membaca session saat replay sudah
   * bersih lalu menulis belakangan bisa "menghidupkan" replay hantu setengah
   * jadi (mis. `{status:"running"}` tanpa total/labels) — pernah terlihat
   * sebagai replay yang macet dan panel kosong. Return replay atau null (bila
   * tidak ada replay untuk ditulis).
   */
  bg.setReplayState = function (patch) {
    return serializeState(async function () {
      var session = await T.getSession();
      if (!session.replay && !patch.recordingId) return null;
      var replay = session.replay && typeof session.replay === "object" ? session.replay : {};
      for (var k in patch) replay[k] = patch[k];
      session.replay = replay;
      await T.setSession(session);
      return session.replay;
    });
  };

  bg.clearReplayState = function () {
    return serializeState(async function () {
      var session = await T.getSession();
      session.replay = null;
      await T.setSession(session);
    });
  };


  /**
   * Promosi loading→running yang AMAN: hanya bila replay di session masih
   * milik tabId dan masih "loading". Return false bila tidak (state sudah
   * dibersihkan/diganti) — pemanggil harus keluar.
   */
  bg.promoteReplay = function (tabId) {
    return serializeState(async function () {
      var session = await T.getSession();
      var r = session.replay;
      if (!r || r.tabId !== tabId || r.status !== "loading") return false;
      r.status = "running";
      await T.setSession(session);
      return true;
    });
  };

  /**
   * Mulai replay: buka tab baru ke startUrl, tunggu PAGE_READY dari content
   * script, lalu kirim step berjalan. Driver tetap hidup selama ada await
   * berantai; untuk navigasi antar-halaman, kelanjutan dipicu message
   * REPLAY_PAGE_READY dari content script (bukan loop yang menggantung).
   *
   * Status lifecycle: loading → running ⇄ paused | waiting-password →
   * done | failed. "loading" = tab dibuka, halaman belum siap. PAGE_READY
   * meng-adopsi tab lalu status naik ke "running". Watchdog 12 dtk menangkap
   * PAGE_READY yang hilang (redirect cepat / injection telat) dengan
   * me-re-inject content script lalu langsung menjalankan driver.
   */
  /**
   * Watchdog tab baru: bila PAGE_READY tak kunjung datang (redirect klien super
   * cepat sampai content script keburu mati, injection telat, dsb.), coba
   * re-inject lalu jalankan driver langsung — jangan biarkan replay mangkrak.
   */
  bg.armStartWatchdog = function (tabId) {
    setTimeout(async function () {
      try {
        var s = await T.getSession();
        if (!s.replay || s.replay.status !== "loading" || s.replay.tabId !== tabId) return;
        try {
          await injectContentScripts(tabId);
        } catch (e) {
          await bg.failReplay(
            "Halaman replay tidak merespons (content script tidak bisa di-inject). Coba lagi."
          );
          return;
        }
        var s2 = await T.getSession();
        if (!s2.replay || s2.replay.status !== "loading") return;
        var who = await bg.whoami(tabId);
        await bg.setReplayState({
          status: "running",
          docToken: who && who.docToken ? who.docToken : s2.replay.docToken || null,
          docUrl: who && who.url ? who.url : s2.replay.docUrl || null
        });
        bg.resumeDriver(tabId);
      } catch (e) {
        /* SW reload di tengah watchdog — biarkan. */
      }
    }, 12000);
  };

  /**
   * Watchdog penanda `pageload`: dokumen baru tidak kunjung datang → gagal
   * eksplisit (dulu: replay menggantung menunggu PAGE_READY yang tak akan ada).
   */
  bg.armDocWatchdog = function (tabId, index) {
    setTimeout(async function () {
      try {
        var s = await T.getSession();
        if (!s.replay || s.replay.tabId !== tabId || !s.replay.awaitingDoc) return;
        if (["running", "loading"].indexOf(s.replay.status) === -1) return;
        await bg.failReplay(
          "Halaman berikutnya tidak termuat setelah 20 detik (penanda ganti halaman di step " +
            ((typeof index === "number" ? index : 0) + 1) +
            "). Navigasi ini tidak bisa dipicu aksi user — rekam ulang, atau tambahkan aksi (klik) yang memicunya.",
          typeof index === "number" ? index : null
        );
      } catch (e) {
        /* SW reload — biarkan. */
      }
    }, 20000);
  };

  bg.startReplay = async function (recordingId, opts) {
    var recordings = await T.getRecordings();
    var rec = null;
    for (var i = 0; i < recordings.length; i++) {
      if (recordings[i] && recordings[i].id === recordingId) rec = recordings[i];
    }
    if (!rec) return { ok: false, error: "recording-not-found" };
    if (!rec.startUrl) return { ok: false, error: "no-start-url" };
    if (!Array.isArray(rec.steps) || rec.steps.length === 0) {
      return { ok: false, error: "no-steps" };
    }
    // Normalisasi di memori: step navigate{url} warisan TIDAK boleh memaksa URL
    // saat replay. Migrasi permanen dilakukan bg.migrateRecordings().
    rec = T.migrateRecording(rec);

    var session = await T.getSession();
    if (session.recording) return { ok: false, error: "recording-in-progress" };
    if (
      session.replay &&
      ["running", "paused", "waiting-password", "loading"].indexOf(session.replay.status) !== -1
    ) {
      return { ok: false, error: "replay-in-progress" };
    }

    var settings = await T.getSettings();
    var allowReuse = !(opts && opts.newTab) && settings.replayReuseTab !== false;

    await bg.setReplayState({
      recordingId: rec.id,
      name: rec.name,
      index: 0,           // step berikutnya yang harus dieksekusi (0-based)
      total: rec.steps.length,
      status: "loading",
      error: null,
      tabId: null,
      // Reset penuh field temporer — setReplayState menambal objek replay
      // LAMA (sisa replay done/failed sebelumnya); tanpa ini sisa
      // docToken/startedIndex/notice replay lama bocor ke yang baru.
      docToken: null,
      docUrl: null,
      // docSeq = jumlah dokumen BARU yang sudah melapor di tab replay ini;
      // pageloadBaseline = nilai docSeq saat step terakhir dikirim. Keduanya
      // WAJIB direset: kalau bocor dari replay sebelumnya, penanda `pageload`
      // membaca "dokumen sudah berganti" padahal belum (ditemukan lewat V3
      // yang jalan setelah replay lain di konteks yang sama).
      docSeq: 0,
      pageloadBaseline: null,
      startedIndex: null,
      awaitingDoc: null,
      awaitingSince: 0,
      reusedTab: false,
      notice: null,
      failedStep: null,
      labels: rec.steps.map(bg.labelForStep), // untuk daftar task di panel/popup
      hints: rec.steps.map(bg.stepHint),
      types: rec.steps.map(function (s) { return (s && s.type) || "?"; }),
    });

    // ---- Mode reuse: pakai tab yang sudah terbuka bila origin-nya sama ----
    // Tidak ada navigasi ke startUrl: user sedang berada di halaman aplikasi
    // (mis. /so/456) dan replay dijalankan di situ — URL/id tidak dipaksakan.
    if (allowReuse) {
      var candidate = await findReuseTab(rec.startUrl);
      if (candidate) {
        var adopted = await bg.adoptTab(candidate.id, rec);
        if (adopted) return { ok: true, total: rec.steps.length, reusedTab: true };
      }
    }

    var tab;
    try {
      tab = await api.tabs.create({ url: rec.startUrl, active: true });
    } catch (e) {
      await bg.failReplay("gagal membuka tab replay (" + e.message + ").");
      return { ok: false, error: "tab-create-failed" };
    }
    await bg.setReplayState({ tabId: tab.id, reusedTab: false });
    bg.armStartWatchdog(tab.id);
    return { ok: true, total: rec.steps.length };
  };

  /**
   * Adopsi tab yang sudah terbuka sebagai tab replay (mode reuse).
   * Return true bila berhasil; false bila harus fallback ke tab baru
   * (content script tidak bisa dihubungi, mis. halaman dilindungi).
   */
  bg.adoptTab = async function (tabId, rec) {
    try {
      await api.tabs.update(tabId, { active: true });
    } catch (e) {
      /* tab bisa saja baru ditutup user — lanjut, WHOAMI yang menentukan */
    }
    var tab = null;
    try {
      tab = await api.tabs.get(tabId);
    } catch (e) {
      return false;
    }
    if (!tab || !T.isRecordableUrl(tab.url)) return false;

    await bg.setReplayState({ tabId: tabId, reusedTab: true });
    if (!(await contentAlive(tabId))) {
      try {
        await injectContentScripts(tabId);
      } catch (e) {
        /* WHOAMI di bawah yang memutuskan */
      }
    }
    var who = await bg.whoami(tabId);
    if (!who) {
      await bg.setReplayState({ tabId: null, reusedTab: false });
      return false;
    }
    await bg.setReplayState({
      docToken: who.docToken,
      docUrl: who.url || tab.url || null,
      status: "running",
      notice: "Memakai tab yang sedang terbuka (domain sama) — tanpa membuka tab baru."
    });
    bg.resumeDriver(tabId);
    return true;
  };

  /**
   * Fallback nama manusiawi dari kandidat selector (rekaman lama tanpa
   * `step.name`): teks accessible → atribut name/aria/placeholder/testid → id.
   * Return "" bila tidak ada yang layak (labelForStep tetap punya fallback).
   */
  bg.hintFromSelector = function (sel) {
    if (!sel || typeof sel !== "object") return "";
    if (sel.text) return String(sel.text).replace(/\s+/g, " ").trim().slice(0, 40);
    var cands = [];
    if (sel.css) cands.push(String(sel.css));
    if (sel.alt && sel.alt.length) {
      for (var i = 0; i < sel.alt.length; i++) {
        if (sel.alt[i] && sel.alt[i].css) cands.push(String(sel.alt[i].css));
        if (sel.alt[i] && sel.alt[i].text) return String(sel.alt[i].text).slice(0, 40);
      }
    }
    for (var j = 0; j < cands.length; j++) {
      var m = cands[j].match(/\[(?:name|aria-label|placeholder|data-testid|data-test|data-cy)="([^"]+)"/i);
      if (m && m[1]) return m[1].replace(/[_-]+/g, " ").trim().slice(0, 40);
    }
    for (var k = 0; k < cands.length; k++) {
      if (cands[k].charAt(0) === "#" && cands[k].length > 1) {
        return cands[k].slice(1).replace(/[_-]+/g, " ").trim().slice(0, 40);
      }
    }
    var first = String(cands[0] || "");
    var short = first.replace(/\[.*$/, "").split(">").pop().trim();
    return short.slice(0, 32);
  };

  /** Label pendek satu step untuk daftar task (nama manusiawi, bukan selector). */
  bg.labelForStep = function (step) {
    if (!step) return "step";
    // Penanda ganti dokumen tanpa URL — tidak ada aksi elemen sama sekali.
    if (step.type === "pageload" || step.type === "navigate") return "muat halaman berikutnya";
    var target = step.name ? String(step.name).slice(0, 40) : bg.hintFromSelector(step.selector);
    switch (step.type) {
      case "input":
        return (step.masked ? "password " : "isi ") + (target || "field");
      case "select":
        return "pilih " + (target || "dropdown") + (step.value ? " = " + String(step.value).slice(0, 16) : "");
      case "check":
        return (step.value === "checked" ? "centang " : "lepas ") + (target || "checkbox");
      case "key":
        return "tombol " + String(step.value || "");
      case "assert": {
        var mode = step.assertMode || "text";
        // Jangan pernah bocorkan value password di daftar task.
        var expect = step.masked ? "***" : '"' + String(step.value == null ? "" : step.value).slice(0, 18) + '"';
        if (mode === "value") return "verifikasi nilai " + (target || "field") + " = " + expect;
        if (mode === "checked") return (step.value === "checked" ? "verifikasi tercentang " : "verifikasi tidak tercentang ") + (target || "checkbox");
        if (mode === "visible") return "verifikasi tampil " + (target || "elemen");
        return "verifikasi teks " + (target || "elemen") + (step.value ? " mengandung " + expect : "");
      }
      case "click":
        return (step.dblclick ? "klik 2x " : step.button === "right" ? "klik kanan " : "klik ") +
          (target || "elemen");
      default:
        return step.type || "step";
    }
  };

  /** Baris sekunder panel: selector teknis (untuk debugging), bukan judul step. */
  bg.stepHint = function (step) {
    if (!step) return "";
    if (step.type === "pageload" || step.type === "navigate") return "tunggu dokumen baru";
    var sel = step.selector || {};
    var which = sel.css || (sel.alt && sel.alt[0] && sel.alt[0].css) || sel.xpath || "";
    which = String(which);
    if (which.length > 64) which = which.slice(0, 61) + "…";
    if (which) return which;
    if (step.type === "key") return "keyboard";
    return "";
  };

  /** Ringkasan step untuk pesan error. */
  bg.describeStep = function (step, index) {
    var n = (typeof index === "number" ? index : 0) + 1;
    if (step && (step.type === "pageload" || step.type === "navigate")) {
      return "Step " + n + " (muat halaman berikutnya)";
    }
    var sel = step && step.selector ? step.selector : {};
    var which =
      sel.css ||
      sel.text ||
      sel.xpath ||
      (sel.alt && sel.alt[0] && sel.alt[0].css) ||
      "(tanpa selector)";
    var nm = step && step.name ? " \"" + String(step.name).slice(0, 30) + "\"" : "";
    return "Step " + n + " (" + (step && step.type ? step.type : "?") + nm + " → " + which + ")";
  };

  /**
   * Jalankan driver replay dari state session saat ini, dengan penanganan
   * kegagalan konsisten. SEMUA titik resume driver memakai helper ini —
   * sebelumnya boilerplate runReplayFrom(...).catch(failReplay("Replay
   * terputus…")) disalin 8× dan salah satu salinannya pasti berbeda.
   */
  bg.resumeDriver = function (tabId) {
    bg.runReplayFrom(tabId).catch(function (e) {
      bg.failReplay("Replay terputus: " + (e && e.message ? e.message : e));
    });
  };

  /**
   * Checkpoint driver: apakah replay masih hidup, running, di tab ini, dan
   * index belum digeser? Dipanggil di SETIAP titik driver bisa kalah balapan
   * dengan Pause/Skip/Stop — awal iterasi, setelah jeda, di antara retry
   * kirim. Return:
   *   "ok"      → lanjut eksekusi
   *   "stop"    → replay di-pause/stop/clear — flags dibersihkan, keluar diam
   *   "handoff" → index digeser (SKIP saat running) — flags dibersihkan dan
   *               driver baru diluncurkan dari index terbaru; keluar
   */
  async function driverCheckpoint(tabId, index) {
    var s = await T.getSession();
    if (!s.replay || s.replay.status !== "running" || s.replay.tabId !== tabId) {
      replayDriverActive = false;
      replayDriverIndex = -1;
      return "stop";
    }
    if ((s.replay.index || 0) !== index) {
      replayDriverActive = false;
      replayDriverIndex = -1;
      bg.resumeDriver(tabId);
      return "handoff";
    }
    return "ok";
  }

  /**
   * Jeda step yang BISA diinterupsi: Pause/Skip/Stop di tengah delayMs
   * (hingga 2000 ms) efektif dalam ~100 ms, bukan setelah jeda selesai.
   * Polling session tiap ~100 ms — session adalah sumber kebenaran bersama
   * (SW-safe), tidak ada kanal cancellable khusus yang harus di-supervise.
   * Resolve false bila checkpoint gagal (flags sudah dibersihkan) — pemanggil
   * tinggal keluar tanpa mengeksekusi step.
   */
  async function interruptibleWait(ms, tabId, index) {
    var wake = Date.now() + ms;
    while (Date.now() < wake) {
      await T.sleep(Math.min(100, wake - Date.now()));
      if ((await driverCheckpoint(tabId, index)) !== "ok") return false;
    }
    return true;
  }

  /**
   * Tulis status "running" untuk iterasi step index — KECUALI bila guard
   * reload menandai pendingPause (dokumen baru melapor saat ada step
   * in-flight yang nasibnya tidak jelas). Tanpa ini, tulisan driver bisa
   * menimpa pause hasil guard (race PAGE_READY vs re-send retry) dan replay
   * melanjutkan buta di halaman yang sudah di-reset.
   * Return false bila driver harus keluar (flags sudah dibersihkan).
   */
  /**
   * Catat baseline dokumen (`docSeq`) SEBELUM step dieksekusi. Penanda
   * `pageload` setelah step ini hanya menunggu bila dokumen memang belum
   * berganti sejak titik ini. Tanpa baseline, PAGE_READY yang tiba di tengah
   * eksekusi step (navigasi akibat klik step itu) membuat penanda salah
   * menyimpulkan "dokumen belum berganti" → replay mangkrak menunggu dokumen
   * yang sudah tiba, lalu gagal 20 dtk palsu (terjadi pada flow multi-halaman).
   */
  async function markDocBaseline() {
    await serializeState(async function () {
      var s = await T.getSession();
      if (!s.replay) return;
      s.replay.pageloadBaseline = s.replay.docSeq || 0;
      await T.setSession(s);
    });
  }

  async function runWrite(tabId, index) {
    var s = await T.getSession();
    if (!s.replay || s.replay.tabId !== tabId || s.replay.pendingPause) {
      replayDriverActive = false;
      replayDriverIndex = -1;
      return false;
    }
    await bg.setReplayState({ index: index, status: "running", error: null });
    return true;
  }

  /**
   * Lanjutkan replay dari step index pada tab yang baru melapor PAGE_READY.
   * Dipanggil dari REPLAY_PAGE_READY. Serial, satu step per saat.
   */
  bg.runReplayFrom = async function (tabId) {
    var session = await T.getSession();
    var replay = session.replay;
    // "loading" diterima: PAGE_READY pertama tab replay menaikkan status ke
    // "running" di sini (satu titik promosi — dulu replay mangkrak selamanya
    // di "loading" karena tidak ada yang mempromosikannya).
    if (!replay || ["running", "loading"].indexOf(replay.status) === -1) return;
    if (replay.tabId !== tabId) return; // bukan tab replay
    if (replay.status === "loading") {
      // Dijaga: promosi tidak boleh menghidupkan replay yang sudah dibersihkan
      // atau diganti replay lain di antara await di atas.
      var promoted = await bg.promoteReplay(tabId);
      if (!promoted) return;
    }

    var recordings = await T.getRecordings();
    var rec = null;
    for (var i = 0; i < recordings.length; i++) {
      if (recordings[i] && recordings[i].id === replay.recordingId) rec = recordings[i];
    }
    if (!rec) {
      await bg.failReplay("Recording tidak ditemukan lagi.");
      return;
    }

    // Normalisasi di memori: warisan navigate{url} jadi penanda pageload tanpa
    // URL — replay TIDAK PERNAH memindahkan halaman atas inisiatif sendiri.
    var steps = T.migrateSteps(rec.steps);
    var index = replay.index || 0;

    if (replayDriverActive) return; // sudah ada driver berjalan untuk replay ini
    replayDriverActive = true;

    while (index < steps.length) {
      var step = steps[index];
      replayDriverIndex = index;

      // Liveness + konsistensi index: Pause/Skip/Stop bisa mengubah state
      // di tengah jalan (lihat driverCheckpoint).
      if ((await driverCheckpoint(tabId, index)) !== "ok") return;

      // Kompatibilitas recording lama: komponen menu/dropdown/accordion kadang
      // me-re-dispatch klik sintetis yang ikut terekam sebagai pasangan step
      // identik berjarak ≤50 ms. Saat replay, klik kedua langsung menutup
      // kembali menu yang baru dibuka. Klik manusia tidak sesingkat itu
      // (double-click terekam sebagai step dblclick), jadi pasangan dieksekusi
      // sekali: klik PERTAMA yang dipertahankan — delayMs-nya adalah jeda
      // manusia yang sesungguhnya sebelum aksi itu.
      var skipNext = false;
      if (step.type === "click") {
        var nextStep = steps[index + 1];
        if (
          nextStep &&
          nextStep.type === "click" &&
          (nextStep.delayMs || 0) <= 50 &&
          JSON.stringify(nextStep.selector) === JSON.stringify(step.selector)
        ) {
          skipNext = true;
        }
      }

      // Liveness + konsistensi index: Pause/Skip/Stop bisa mengubah state
      // di tengah jalan (lihat driverCheckpoint). runWrite menghormati
      // pendingPause dari guard reload — jangan menimpa pause itu.
      if (!(await runWrite(tabId, index))) return;

      // ------------------------- pageload -------------------------
      // Penanda TANPA URL: dokumen berganti sebagai efek aksi sebelumnya
      // (submit form / redirect antar-dokumen). Tidak ada aksi yang dieksekusi
      // dan tidak ada URL yang dipaksakan — driver hanya memastikan sudah
      // berada di dokumen baru, lalu lanjut. Bila dokumen tak kunjung berganti
      // (navigasi yang tidak bisa dipicu aksi user), watchdog gagal eksplisit.
      if (step.type === "pageload") {
        var pgSession = await T.getSession();
        var pgReplay = pgSession.replay || {};
        var pgToken = pgReplay.docToken || null;
        var whoNow = await bg.whoami(tabId);
        // "Sudah berganti dokumen?" DUA sinyal:
        //   1. docSeq > pageloadBaseline — dokumen baru MELAPOR (PAGE_READY)
        //      sejak step sebelumnya dicatat; ini tahan terhadap PAGE_READY
        //      yang datang sementara step sebelumnya masih dieksekusi.
        //   2. docToken sesi berbeda dari dokumen yang hidup sekarang — jalur
        //      lama, tetap dipakai bila belum ada baseline (mis. penanda di
        //      step pertama).
        var docChanged =
          typeof pgReplay.pageloadBaseline === "number"
            ? (pgReplay.docSeq || 0) > pgReplay.pageloadBaseline
            : false;
        if (!docChanged && whoNow && whoNow.docToken && whoNow.docToken !== pgToken) {
          docChanged = true;
        }
        if (docChanged) {
          // Sudah pindah dokumen sebelum penanda ini tercapai.
          await bg.setReplayState({
            docToken: whoNow.docToken,
            docUrl: whoNow.url || null,
            index: index + 1,
            status: "running",
            startedIndex: null,
            awaitingDoc: null,
            awaitingSince: 0
          });
          index += 1;
          continue;
        }
        // Masih dokumen lama (atau content script sedang dibongkar saat
        // navigasi): parkir, tunggu PAGE_READY dokumen berikutnya.
        await bg.setReplayState({
          index: index + 1,
          status: "running",
          startedIndex: null,
          awaitingDoc: true,
          awaitingSince: Date.now()
        });
        bg.armDocWatchdog(tabId, index);
        replayDriverActive = false;
        replayDriverIndex = -1;
        return;
      }

      // ----------------------- step di-halaman ----------------------
      // Jeda dari step sebelumnya (clamp 0..2000) — bagian dari format step.
      // BISA diinterupsi: Pause/Skip/Stop selama jeda efektif dlm ~100 ms.
      var delay = Math.min(2000, Math.max(0, step.delayMs || 0));
      if (delay > 0 && !(await interruptibleWait(delay, tabId, index))) {
        // State berubah saat tidur (pause/stop/skip) — checkpoint sudah
        // membersihkan flags dan meluncurkan driver baru bila SKIP. Keluar.
        return;
      }

      // Re-check SETELAH tidur: Pause/Skip bisa terjadi selama driver
      // menunggu delayMs — tanpa ini, step yang di-skip tetap tereksekusi.
      // (Satu-satunya checkpoint saat delay = 0.)
      if ((await driverCheckpoint(tabId, index)) !== "ok") return;

      // Baseline dokumen untuk penanda `pageload` berikutnya — dicatat SEBELUM
      // step dikirim (lihat markDocBaseline).
      await markDocBaseline();

      // Tandai step IN FLIGHT: bila tab mati di tengah eksekusi (crash, reload
      // manual), PAGE_READY dokumen baru melihat index === startedIndex dan
      // mem-parkir replay di paused alih-alih mengulang aksi di halaman yang
      // sudah di-reset (guard reload — lihat handler PAGE_READY).
      await bg.setReplayState({ startedIndex: index });

      var result = null;
      var attempt = 0;
      while (true) {
        try {
          result = await api.tabs.sendMessage(tabId, {
            type: "TESTERIA_REPLAY_RUN",
            step: step,
            stepNumber: index + 1,
            total: steps.length
          });
          break;
        } catch (e) {
          // Dokumen sedang berganti (navigasi/reload penuh) — BUKAN content
          // script rusak: parkir dan tunggu PAGE_READY dokumen baru. Tanpa ini,
          // flow multi-halaman (klik submit → halaman baru) mati di tengah.
          if (await tabIsTurning(tabId)) {
            await bg.setReplayState({ awaitingDoc: true, awaitingSince: Date.now() });
            bg.armDocWatchdog(tabId, index);
            replayDriverActive = false;
            replayDriverIndex = -1;
            return;
          }
          // Content script belum hidup (document sedang berputar) — beri waktu
          // sebentar lalu coba lagi (maks 12× ≈ 3 dtk) sebelum gagal. Dulu
          // error ini langsung mematikan replay padahal halaman sedang loading.
          attempt++;
          if (attempt > 12) {
            await bg.failReplay(
              bg.describeStep(step, index) +
                ": content script tidak bisa dihubungi (" +
                (e && e.message ? e.message : "no receiver") +
                ").",
              index
            );
            return;
          }
          await T.sleep(250);
          // Stop/pause/skip saat menunggu content script hidup: checkpoint,
          // jangan terus me-retry step yang mungkin sudah tidak diinginkan.
          if ((await driverCheckpoint(tabId, index)) !== "ok") return;
        }
      }

      // Stop di tengah eksekusi step TIDAK boleh dilanjutkan: memajukan index
      // berarti menghidupkan kembali replay yang sudah di-stop user (dulu
      // setReplayState menciptakan ulang objek replay dari nol). Pause di
      // tengah eksekusi TETAP mencatat index — efek step sudah terjadi di
      // halaman, resume tidak boleh mengulangnya. Skip saat eksekusi juga
      // diterima: index digeser ke step berikutnya, dan checkpoint awal
      // iterasi berikutnya yang menyeraahkan eksekusi ke driver baru.
      var sAfter = await T.getSession();
      if (
        !sAfter.replay ||
        sAfter.replay.tabId !== tabId ||
        ["running", "paused"].indexOf(sAfter.replay.status) === -1
      ) {
        replayDriverActive = false;
        replayDriverIndex = -1;
        return;
      }
      if ((sAfter.replay.index || 0) !== index) {
        // Index digeser saat step dieksekusi (SKIP saat running) — sinkronkan
        // ke index terbaru; iterasi berikutnya langsung mengeksekusi step yang
        // diminta user (checkpoint awal iterasi tetap memvalidasi).
        index = sAfter.replay.index || 0;
      }

      if (!result || !result.ok) {
        // Step DIBATALKAN user (Stop/Skip/Pause) di tengah eksekusi: jangan
        // pernah melaporkannya sebagai kegagalan — user sengaja membatalkan.
        if (result && result.aborted) {
          replayDriverActive = false;
          replayDriverIndex = -1;
          var abortedSession = await T.getSession();
          if (
            abortedSession.replay &&
            abortedSession.replay.tabId === tabId &&
            abortedSession.replay.status === "running"
          ) {
            bg.resumeDriver(tabId); // Skip: eksekusi step berikutnya
          }
          return;
        }
        var reason = result && result.error ? result.error : "alasan tidak diketahui";
        await bg.failReplay(bg.describeStep(step, index) + ": " + reason + ".", index);
        return;
      }

      // Upgrade label best-effort untuk rekaman lama tanpa `step.name`: replayer
      // mengembalikan nama manusiawi elemen yang benar-benar ditemukan (mis.
      // "Email"), sehingga daftar step di panel langsung terbaca manusia dan
      // tetap sinkron dengan elemen nyata di halaman.
      if (!step.name && result.name) {
        var lblSession = await T.getSession();
        var lblNow =
          lblSession.replay && Array.isArray(lblSession.replay.labels)
            ? lblSession.replay.labels[index]
            : null;
        var upgraded = bg.labelForStep(Object.assign({}, step, { name: result.name }));
        if (upgraded && upgraded !== lblNow && lblSession.replay) {
          var newLabels = lblSession.replay.labels.slice();
          newLabels[index] = upgraded;
          await bg.setReplayState({ labels: newLabels });
        }
      }

      if (result.waitPassword) {
        // Password (masked): prompt tampil di halaman; JANGAN biarkan channel
        // pesan terbuka menunggu user — content script sudah menjawab dan
        // hasilnya datang belakangan lewat message TESTERIA_STEP_DONE
        // (tahan terhadap SW reload). Index TIDAK dimajukan.
        await bg.setReplayState({ status: "waiting-password", error: null });
        replayDriverActive = false;
        replayDriverIndex = -1;
        return;
      }

      index += skipNext ? 2 : 1;
      await bg.setReplayState({ index: index, startedIndex: null });
    }

    // Selesai semua step.
    replayDriverActive = false;
    replayDriverIndex = -1;
    await bg.setReplayState({ status: "done", error: null });
  };

  /** Tandai replay gagal (popup & overlay menampilkannya). */
  bg.failReplay = async function (message, stepIndex) {
    replayDriverActive = false;
    replayDriverIndex = -1;
    await bg.setReplayState({
      status: "failed",
      error: String(message || "unknown"),
      failedStep: typeof stepIndex === "number" ? stepIndex : null,
      // Step yang GAGAL eksplisit tidak sempat mengeksekusi aksinya —
      // startedIndex dibersihkan agar retry/lanjut boleh mengulangnya.
      startedIndex: null
    });
  };

  bg.stopReplay = async function () {
    var stopSession = await T.getSession();
    bg.abortInFlight(stopSession.replay && stopSession.replay.tabId ? stopSession.replay.tabId : null);
    replayDriverActive = false;
    replayDriverIndex = -1;
    await bg.clearReplayState();
    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Message router
  // ---------------------------------------------------------------------------
  // Handler diserialisasi dalam satu antrean promise: beberapa pesan bisa
  // datang beruntunan (mis. flush input lalu navigate dari recorder) dan semua
  // handler melakukan read-modify-write session di storage — tanpa antrean,
  // tulisan handler A bisa tertimpa handler B yang membaca state lebih lama.
  var handlerQueue = Promise.resolve();
  api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    handlerQueue = handlerQueue.then(function () {
      return (async function () {
        try {
          if (!msg || typeof msg.type !== "string") return;

        switch (msg.type) {
          // ------------------------------------------------ recording
          case "TESTERIA_TOGGLE_RECORD": {
            var tabId = sender.tab ? sender.tab.id : undefined;
            var url = sender.tab ? sender.tab.url : undefined;
            var out = await bg.toggleRecording("content", tabId, url);
            sendResponse(out);
            return;
          }

          case "TESTERIA_PAGE_READY": {
            var pageUrl = sender.tab ? sender.tab.url : null;
            var sTabId = sender.tab ? sender.tab.id : null;
            var session = await T.getSession();

            if (session.recording) {
              var isRecordingTab = sTabId === session.recordingTabId;
              // Ganti dokumen PENUH di tab recording → penanda TANPA URL
              // (`pageload`). URL/id tidak pernah masuk ke step: navigasi SPA
              // tidak terekam sama sekali (FE yang routing dari aksi user),
              // dan penanda ini hanya berarti "dokumen berganti".
              if (isRecordingTab) {
                var lastDoc = session.lastDocUrl || session.startUrl;
                if (T.isRecordableUrl(pageUrl) && pageUrl !== lastDoc) {
                  session.pendingSteps.push({
                    type: "pageload",
                    selector: null,
                    value: null,
                    name: null,
                    delayMs: 0,
                    ts: T.now() - (session.startedAt || T.now())
                  });
                  session.lastDocUrl = pageUrl;
                  await T.setSession(session);
                }
              }
              // REC dot di tab mana pun selama sesi recording global aktif dan
              // tab ini adalah tab recording (multi-tab tidak didukung v1).
              if (isRecordingTab) {
                api.tabs
                  .sendMessage(sTabId, { type: "TESTERIA_REC_STATE", recording: true })
                  .catch(function () {});
              }
            } else if (
              session.replay &&
              ["running", "loading", "waiting-password", "paused"].indexOf(session.replay.status) !== -1 &&
              session.replay.tabId === sTabId
            ) {
              // Halaman replay selesai load → lanjutkan eksekusi step.
              // Status tidak dinaikkan ke "running" di sini: bila replay sedang
              // waiting-password/paused, tabId match saja yang kita perlukan —
              // PAGE_READY tab yang sama (mis. reload manual) tidak boleh
              // menimpa status. runReplayFrom sendiri yang me-cek status.
              var rp = session.replay;
              var token = typeof msg.docToken === "string" ? msg.docToken : null;
              var rpChanged = false;
              if (token && token !== rp.docToken) {
                // Dokumen BARU di tab replay. Bila step sebelumnya sempat
                // DIKIRIM tapi tidak pernah dilaporkan selesai (index ===
                // startedIndex — signature mati di tengah step) DAN URL barunya
                // SAMA dengan dokumen sebelumnya (reload sungguhan, bukan
                // redirect), jangan lanjut buta: halaman sudah di-reset,
                // mengulang klik bisa double-submit. Parkir di paused — user
                // yang memutuskan (Lanjutkan / Skip). URL BERBEDA (redirect
                // antar halaman) tetap dilanjutkan otomatis: step itu belum
                // sempat jalan di dokumen lama (dulu: rescue re-send).
                var midStep =
                  typeof rp.startedIndex === "number" &&
                  (rp.index || 0) === rp.startedIndex &&
                  ["running", "loading", "waiting-password"].indexOf(rp.status) !== -1;
                var sameDoc =
                  typeof rp.docUrl === "string" && rp.docUrl === pageUrl;
                rp.docToken = token;
                rp.docUrl = pageUrl;
                // Penghitung dokumen baru: dipakai penanda `pageload` supaya
                // "dokumen sudah berganti" tidak disimpulkan dari
                // perbandingan docToken (PAGE_READY bisa datang SEMENTARA step
                // sebelumnya masih in-flight — dulu itu membuat penanda
                // mengira dokumen belum berganti lalu mangkrak 20 dtk).
                rp.docSeq = (typeof rp.docSeq === "number" ? rp.docSeq : 0) + 1;
                if (rp.awaitingDoc) {
                  // Penanda `pageload` terpenuhi: dokumen baru sudah melapor.
                  rp.awaitingDoc = null;
                  rp.awaitingSince = 0;
                  rpChanged = true;
                }
                if (midStep && sameDoc) {
                  rp.status = "paused";
                  rp.pendingPause = true; // STICKY: driver (re-send retry!) tidak boleh menimpa
                  rp.notice =
                    "Halaman dimuat ulang di tengah step " + (rp.startedIndex + 1) +
                    " — step mungkin sudah sempat jalan. Lanjutkan untuk mengulang step ini, atau Skip untuk melewatinya.";
                }
                rpChanged = true;
              }
              if (rpChanged) await T.setSession(session);
              bg.resumeDriver(sTabId);
              // Tidak sendResponse — driver berjalan async.
            }
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_RECORD_STEP": {
            var rSession = await T.getSession();
            if (!rSession.recording) {
              sendResponse({ ok: false, error: "not-recording" });
              return;
            }
            if (!rSession.recordingTabId || sender.tab.id !== rSession.recordingTabId) {
              sendResponse({ ok: false, error: "wrong-tab" });
              return;
            }
            var step = msg.step;
            if (!step || typeof step.type !== "string") {
              sendResponse({ ok: false, error: "bad-step" });
              return;
            }
            // ts relatif + delayMs clamp [0, 2000]
            step.ts = Math.max(0, T.now() - (rSession.startedAt || T.now()));
            var prev = rSession.pendingSteps[rSession.pendingSteps.length - 1];
            var rawDelay = prev ? step.ts - prev.ts : 0;
            if (!step.delayMs) step.delayMs = 0;
            step.delayMs = Math.min(2000, Math.max(0, rawDelay));
            if (!step.delayMs) step.delayMs = 0;
            rSession.pendingSteps.push(step);
            await T.setSession(rSession);
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_SAVE_RECORDING": {
            var saved = await bg.saveRecording(msg.name, msg.steps, msg.startUrl);
            sendResponse(saved);
            return;
          }

          case "TESTERIA_DISCARD_RECORDING": {
            sendResponse(await bg.discardRecording());
            return;
          }

          // -------------------------------------------------- replay
          case "TESTERIA_QUICK_LIST": {
            // Data untuk quick menu F9: daftar recording + status berjalan.
            var ql = await T.getSession();
            var qRecs = await T.getRecordings();
            var qEntries = [];
            for (var qi = 0; qi < qRecs.length; qi++) {
              var qRec = qRecs[qi];
              if (!qRec || !qRec.startUrl || !Array.isArray(qRec.steps) || !qRec.steps.length) continue;
              qEntries.push({
                id: qRec.id,
                name: qRec.name,
                group: typeof qRec.group === "string" && qRec.group ? qRec.group : null,
                meta: qRec.steps.length + " step · " + (function () {
                  try {
                    return new URL(qRec.startUrl).hostname;
                  } catch (e) {
                    return "";
                  }
                })()
              });
            }
            var qStatus = "";
            if (ql.recording) qStatus = "● Recording sedang berjalan — tekan F8 untuk berhenti dulu";
            else if (ql.replay && (ql.replay.status === "running" || ql.replay.status === "paused")) {
              qStatus = "Replay sedang berjalan/dijeda — selesaikan atau stop dulu";
            }
            sendResponse({ ok: true, entries: qEntries, statusText: qStatus });
            return;
          }

          case "TESTERIA_REPLAY": {
            // Popup meminta replay dimulai (driver jalan di background).
            // msg.newTab=true → paksa tab baru (user memilih "mulai dari URL
            // rekaman"); default: pakai tab aktif bila domainnya sama.
            sendResponse(await bg.startReplay(msg.id, { newTab: msg.newTab === true }));
            return;
          }

          case "TESTERIA_REPLAY_PAUSE": {
            // Jeda di antara step: driver melihat status bukan "running" pada
            // pemeriksaan liveness dan berhenti dengan index tetap tersimpan.
            var ps = await T.getSession();
            if (!ps.replay || ps.replay.status !== "running") {
              sendResponse({ ok: false, error: "no-running-replay" });
              return;
            }
            // Step in-flight (bila ada) dibatalkan: jeda berarti benar-benar
            // berhenti, bukan "selesaikan dulu step yang sedang mencari elemen".
            bg.abortInFlight(ps.replay.tabId);
            await bg.setReplayState({ status: "paused" });
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_REPLAY_RESUME": {
            var rs = await T.getSession();
            if (!rs.replay || ["paused", "waiting-password"].indexOf(rs.replay.status) === -1 || !rs.replay.tabId) {
              sendResponse({ ok: false, error: "no-paused-replay" });
              return;
            }
            await bg.setReplayState({ status: "running", notice: null, pendingPause: null });
            // Bila driver lama masih hidup (baru akan keluar via liveness
            // check), biarkan dia sendiri melanjutkan — hindari driver ganda.
            if (!bg.replayDriverBusy()) {
              bg.resumeDriver(rs.replay.tabId);
            }
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_REPLAY_SKIP": {
            // Lewati step yang sedang dijeda, menunggu password, ATAU gagal
            // (panel failed menampilkan tombol Skip — kalau status "failed"
            // ditolak di sini, tombolnya jadi no-op diam-diam; ditemukan saat
            // playtest: user klik Skip di panel gagal dan tidak terjadi apa-apa).
            var ks = await T.getSession();
            // "running" ikut diterima: dulu tombol Skip tampil di panel saat
            // replay berjalan tapi handler menolaknya → no-op diam-diam.
            // Cukup geser index — driver yang sedang tidur / mengeksekusi
            // melihatnya lewat checkpoint dan menyerahkan eksekusi ke driver
            // baru dari index terbaru.
            if (!ks.replay || ["running", "paused", "waiting-password", "failed"].indexOf(ks.replay.status) === -1 || !ks.replay.tabId) {
              sendResponse({ ok: false, error: "no-skippable-replay" });
              return;
            }
            var total = ks.replay.total || 0;
            var skipped = (ks.replay.index || 0) + 1;
            var nextIdx = (ks.replay.index || 0) + 1;
            bg.abortInFlight(ks.replay.tabId); // step in-flight (bila ada) dibatalkan
            if (nextIdx >= total) {
              replayDriverActive = false;
              replayDriverIndex = -1;
              await bg.setReplayState({
                index: total,
                status: "done",
                error: null,
                startedIndex: null,
                notice: "Step " + skipped + " dilewati — tidak ada step berikutnya, replay selesai."
              });
            } else {
              await bg.setReplayState({
                index: nextIdx,
                status: "running",
                error: null,
                startedIndex: null,
                notice: "Step " + skipped + " dilewati — lanjut ke step " + (nextIdx + 1) + ".",
                pendingPause: null
              });
              if (!bg.replayDriverBusy()) {
                bg.resumeDriver(ks.replay.tabId);
              }
            }
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_REPLAY_RETRY": {
            // Ulangi step yang gagal: index tetap, status kembali running.
            var rt = await T.getSession();
            if (!rt.replay || rt.replay.status !== "failed" || rt.replay.tabId !== (sender.tab && sender.tab.id)) {
              sendResponse({ ok: false, error: "no-failed-replay" });
              return;
            }
            await bg.setReplayState({ status: "running", error: null });
            bg.resumeDriver(sender.tab.id);
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_STOP_REPLAY": {
            sendResponse(await bg.stopReplay());
            return;
          }

          case "TESTERIA_STEP_DONE": {
            // Hasil eksekusi step password (masked): content script menyelesaikan
            // prompt di halaman lalu melapor. Tahan terhadap SW reload — tidak
            // ada channel pesan yang ditahan terbuka menunggu user.
            var sd = await T.getSession();
            var stOk =
              sd.replay &&
              ["waiting-password", "running", "loading"].indexOf(sd.replay.status) !== -1;
            var idxOk =
              typeof msg.stepIndex !== "number" || msg.stepIndex === (sd.replay && sd.replay.index);
            if (sd.replay && stOk && idxOk && sender.tab && sd.replay.tabId === sender.tab.id) {
              await bg.setReplayState({ status: "running" });
              if (!msg.ok) {
                await bg.failReplay(
                  bg.describeStep(
                    { type: "input", selector: { css: "(password)" } },
                    typeof msg.stepIndex === "number" ? msg.stepIndex : (sd.replay.index || 0)
                  ) + ": " + (msg.error || "prompt password ditutup") + ".",
                  typeof msg.stepIndex === "number" ? msg.stepIndex : sd.replay.index || 0
                );
              } else {
                // Lanjutkan: step password SELESAI → majukan index (dulu lupa,
                // driver resume di index sama → prompt muncul lagi tanpa henti).
                await bg.setReplayState({ index: (sd.replay.index || 0) + 1, status: "running", startedIndex: null, notice: null });
                if (!bg.replayDriverBusy()) {
                  bg.resumeDriver(sender.tab.id);
                }
              }
            }
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_REPLAY_JUMP_TO": {
            // Mulai ulang dari step terpilih di daftar task (1-based).
            var jt = await T.getSession();
            if (!jt.replay || !jt.replay.tabId || ["running", "paused", "waiting-password", "loading", "failed"].indexOf(jt.replay.status) === -1) {
              sendResponse({ ok: false, error: "no-replay" });
              return;
            }
            var idx = typeof msg.step === "number" ? msg.step - 1 : -1;
            var total = jt.replay.total || 0;
            if (idx < 0 || idx >= total) {
              sendResponse({ ok: false, error: "step-out-of-range" });
              return;
            }
            bg.abortInFlight(jt.replay.tabId); // step in-flight tidak boleh lanjut
            // Bila tab replay sudah tertutup, buka lagi dari startUrl recording.
            var rec2 = null;
            var recs2 = await T.getRecordings();
            for (var ri = 0; ri < recs2.length; ri++) {
              if (recs2[ri] && recs2[ri].id === jt.replay.recordingId) rec2 = recs2[ri];
            }
            var tabOk = false;
            try {
              await api.tabs.get(jt.replay.tabId);
              tabOk = true;
            } catch (e) {
              tabOk = false;
            }
            if (!tabOk && rec2 && rec2.startUrl) {
              var t2 = await api.tabs.create({ url: rec2.startUrl, active: true });
              await bg.setReplayState({
                index: idx,
                status: "loading",
                error: null,
                failedStep: null,
                startedIndex: null,
                notice: null,
                docToken: null,
                docUrl: null,
                docSeq: 0,
                pageloadBaseline: null,
                awaitingDoc: null,
                tabId: t2.id
              });
              sendResponse({ ok: true });
              return;
            }
            await bg.setReplayState({ index: idx, status: "running", error: null, failedStep: null, startedIndex: null, notice: null });
            if (!bg.replayDriverBusy()) {
              bg.resumeDriver(jt.replay.tabId);
            }
            sendResponse({ ok: true });
            return;
          }

          default:
            return;
        }
        } catch (e) {
          try {
            sendResponse({ ok: false, error: (e && e.message) || String(e) });
          } catch (e2) {
            /* channel sudah tertutup */
          }
        }
      })();
    });
    return true; // async sendResponse
  });

  // ---------------------------------------------------------------------------
  // Keyboard shortcut resmi (Ctrl+Shift+Y). F8 ditangani fallback keydown di
  // content script (Chrome menolak F8 polos di manifest commands).
  // ---------------------------------------------------------------------------
  api.commands.onCommand.addListener(function (command) {
    if (command === "toggle-recording") {
      bg.toggleRecording("commands").catch(function () {});
      return;
    }
    if (command === "quick-replay") {
      // Command resmi quick menu: teruskan ke tab aktif (content script
      // yang menampilkan menu di tengah layar).
      api.tabs
        .query({ active: true, currentWindow: true })
        .then(function (tabs) {
          if (tabs && tabs[0]) {
            return api.tabs.sendMessage(tabs[0].id, { type: "TESTERIA_OPEN_QUICK" });
          }
        })
        .catch(function () {});
    }
  });

  /** Reset session basi (sisa recording/replay dari run browser sebelumnya). */
  bg.resetStaleSession = async function () {
    var s = await T.getSession();
    s.recording = false;
    s.recordingTabId = null;
    s.pendingSteps = [];
    s.replay = null;
    s.lastToggleFromContent = 0;
    await T.setSession(s);
    await bg.setRecBadge(false);
  };

  // Bersihkan badge & session + migrasi data saat extension dimulai/terpasang.
  // Migrasi menghapus URL dari step rekaman lama (navigate → pageload) supaya
  // replay tidak pernah dipaksa kembali ke id lama (mis. /wo/123).
  function startupMaintenance() {
    bg.resetStaleSession().catch(function () {});
    bg.migrateRecordings().catch(function () {});
  }
  api.runtime.onStartup.addListener(startupMaintenance);
  api.runtime.onInstalled.addListener(startupMaintenance);
  // Service worker Chrome bisa dibangkitkan tanpa event startup (mis. setelah
  // browser lama berjalan) — pastikan migrasi tetap jalan sekali.
  bg.migrateRecordings().catch(function () {});
})();
