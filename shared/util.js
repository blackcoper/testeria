/*
 * Testeria — shared/util.js
 * Alias namespace browser + helper kecil yang dipakai content scripts, popup, dan background.
 *
 * PENTING (lintas browser):
 * - Semua kode Testeria HARUS memakai `browser.*`, bukan `chrome.*`.
 *   - Firefox & Chrome ≥148 punya `browser` native.
 *   - Chromium lain (Edge/Brave, Chrome lama) di-alias di sini: browser ??= chrome.
 * - File ini dimuat sebagai content script DAN bagian dari background (event page Firefox)
 *   via manifest. Service worker Chrome meng-importScripts("shared/util.js") di awal
 *   background/background.js.
 * - Tidak ada pemanggilan `chrome.*` eksplisit di logika mana pun.
 */

/* Alias namespace (idempoten, aman dievaluasi ulang lewat scripting.executeScript). */
var TESTERIA_BROWSER_ALIAS = globalThis.browser || globalThis.chrome;
try {
  if (TESTERIA_BROWSER_ALIAS && globalThis.browser !== TESTERIA_BROWSER_ALIAS) {
    globalThis.browser = TESTERIA_BROWSER_ALIAS;
  }
} catch (e) {
  /* globalThis.browser bisa read-only di konteks tertentu; abaikan. */
}

(function () {
  var api = globalThis.browser;
  if (!api) return;

  var T = globalThis.TESTERIA = globalThis.TESTERIA || {};

  /** URL tab yang valid untuk dijadikan startUrl / target navigasi. */
  T.isRecordableUrl = function (url) {
    return typeof url === "string" && /^https?:/i.test(url);
  };

  /** Timestamp sekarang dalam ms. */
  T.now = function () {
    return Date.now();
  };

  /** id unik sederhana (tanpa crypto.randomUUID agar tidak butuh secure context). */
  T.makeId = function () {
    return (
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 10)
    );
  };

  /** Promise-based sleep. */
  T.sleep = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  };

  /** Default session state (persisten di storage.local, BUKAN variabel background). */
  T.defaultSession = function () {
    return {
      recording: false,        // status recording aktif
      recordingTabId: null,    // tab tempat record berjalan
      pendingSteps: [],        // buffer step recording aktif (ditulis per-step)
      startUrl: null,          // URL saat record dimulai
      lastDocUrl: null,        // URL dokumen terakhir saat recording (transien, bukan step)
      startedAt: 0,            // ms epoch saat record dimulai (untuk ts relatif)
      lastToggleFromContent: 0, // guard anti double-toggle (commands + keydown)
      replay: null             // { recordingId, name, index, total, status, error, stepIndex1Based }
    };
  };

  /**
   * Baca session dari storage.local dengan normalisasi + backfill field baru.
   * Selalu mengembalikan objek lengkap.
   */
  T.getSession = async function () {
    var res = await api.storage.local.get("session");
    var s = res && res.session;
    var d = T.defaultSession();
    if (!s || typeof s !== "object") return d;
    for (var k in d) {
      if (!(k in s)) s[k] = d[k];
    }
    return s;
  };

  /** Tulis session lengkap ke storage.local. */
  T.setSession = async function (session) {
    await api.storage.local.set({ session: session });
    return session;
  };

  /** Baca daftar recording (array; [] bila kosong/rusak). */
  T.getRecordings = async function () {
    var res = await api.storage.local.get("recordings");
    var r = res && res.recordings;
    return Array.isArray(r) ? r : [];
  };

  /** Tulis daftar recording. */
  T.setRecordings = async function (recordings) {
    await api.storage.local.set({ recordings: recordings });
    return recordings;
  };

  // ---------------------------------------------------------------------------
  // Settings (settings.* di storage.local) dengan default aman
  // ---------------------------------------------------------------------------

  /**
   * Baca settings + isi default. Default sengaja di sini (satu sumber):
   *   replayInstant  : false — kursor beranimasi (mode halus) secara default
   *   replayReuseTab : true  — pakai tab aktif bila domainnya sama
   */
  T.getSettings = async function () {
    var res = await api.storage.local.get("settings");
    var s = res && res.settings && typeof res.settings === "object" ? res.settings : {};
    return {
      replayInstant: s.replayInstant === true,
      replayReuseTab: s.replayReuseTab !== false
    };
  };

  /** Tulis sebagian settings (merge). */
  T.setSettings = async function (patch) {
    var res = await api.storage.local.get("settings");
    var s = Object.assign({}, (res && res.settings) || {}, patch || {});
    await api.storage.local.set({ settings: s });
    return s;
  };

  // ---------------------------------------------------------------------------
  // Migrasi step: URL TIDAK PERNAH menjadi bagian step.
  //
  // Rekaman lama menyimpan navigasi sebagai step `navigate` berisi URL (dengan
  // id spesifik, mis. /wo/123). Saat replay, URL itu memaksa halaman kembali ke
  // id lama — padahal navigasi SPA seharusnya datang dari aksi user (FE yang
  // routing). Migrasi mengubahnya jadi penanda tanpa URL `pageload` yang hanya
  // berarti "tunggu dokumen baru", dan menghapus `url` dari semua step.
  // ---------------------------------------------------------------------------

  /** Versi skema step saat ini (dinaikkan bila bentuk step berubah). */
  T.STEP_SCHEMA_VERSION = 4;

  /** Normalisasi satu step (murni, tanpa I/O). Return step baru. */
  T.migrateStep = function (step) {
    if (!step || typeof step !== "object") return step;
    var s = {};
    for (var k in step) s[k] = step[k];
    if (s.type === "navigate") s.type = "pageload";
    if (s.type === "pageload") {
      s.selector = null;
      s.value = null;
    }
    // URL tidak pernah menjadi bagian step — hapus permanen.
    delete s.url;
    return s;
  };

  /** Normalisasi array step. */
  T.migrateSteps = function (steps) {
    if (!Array.isArray(steps)) return [];
    var out = [];
    for (var i = 0; i < steps.length; i++) out.push(T.migrateStep(steps[i]));
    return out;
  };

  /** Normalisasi satu recording (steps + field lain apa adanya). */
  T.migrateRecording = function (rec) {
    if (!rec || typeof rec !== "object") return rec;
    var r = {};
    for (var k in rec) r[k] = rec[k];
    r.steps = T.migrateSteps(rec.steps);
    return r;
  };

  /** Normalisasi daftar recording. */
  T.migrateRecordings = function (recs) {
    if (!Array.isArray(recs)) return [];
    var out = [];
    for (var i = 0; i < recs.length; i++) out.push(T.migrateRecording(recs[i]));
    return out;
  };

  /** Apakah daftar recording masih punya step warisan (navigate / ber-url)? */
  T.recordingsNeedMigration = function (recs) {
    if (!Array.isArray(recs)) return false;
    for (var i = 0; i < recs.length; i++) {
      var steps = recs[i] && recs[i].steps;
      if (!Array.isArray(steps)) continue;
      for (var j = 0; j < steps.length; j++) {
        var s = steps[j];
        if (!s || typeof s !== "object") continue;
        if (s.type === "navigate") return true;
        if (s.type === "pageload" && s.url) return true;
        if ("url" in s) return true;
      }
    }
    return false;
  };
})();
