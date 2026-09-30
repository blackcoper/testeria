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
})();
