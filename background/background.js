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

  /** Mulai recording di tab tertentu. */
  bg.startRecording = async function (tabId, url) {
    var session = await T.getSession();
    if (session.recording) return { ok: false, error: "already-recording" };

    session.recording = true;
    session.recordingTabId = tabId;
    session.pendingSteps = [];
    session.startUrl = T.isRecordableUrl(url) ? url : null;
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
        await api.scripting.executeScript({
          target: { tabId: target.id, allFrames: false },
          files: [
            "shared/util.js",
            "content/overlay.js",
            "content/selector.js",
            "content/recorder.js",
            "content/replayer.js",
            "content/main.js"
          ]
        });
      } catch (e) {
        /* Halaman yang melarang injection (mis. web store) — recording tetap
           aktif; content script akan ikut saat navigasi berikutnya. */
      }
    }
    // Patch history di MAIN world — pushState dari kode halaman tidak terlihat
    // dari isolated world (world berbeda → wrapper JS berbeda). Tanpa ini,
    // navigasi SPA tidak terekam sama sekali.
    try {
      await api.scripting.executeScript({
        target: { tabId: target.id, allFrames: false },
        world: "MAIN",
        files: ["content/spa-main.js"]
      });
    } catch (e) {
      /* Firefox lama tanpa world: MAIN — SPA SPA-recording degrade ke popstate
         saja; fitur lain tetap jalan. */
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

  bg.setReplayState = async function (patch) {
    var session = await T.getSession();
    var replay = session.replay && typeof session.replay === "object" ? session.replay : {};
    for (var k in patch) replay[k] = patch[k];
    session.replay = replay;
    await T.setSession(session);
    return session.replay;
  };

  bg.clearReplayState = async function () {
    var session = await T.getSession();
    session.replay = null;
    await T.setSession(session);
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
  bg.startReplay = async function (recordingId) {
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

    var session = await T.getSession();
    if (session.recording) return { ok: false, error: "recording-in-progress" };
    if (
      session.replay &&
      ["running", "paused", "waiting-password", "loading"].indexOf(session.replay.status) !== -1
    ) {
      return { ok: false, error: "replay-in-progress" };
    }

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
      startedIndex: null,
      notice: null,
      failedStep: null,
      labels: rec.steps.map(bg.labelForStep) // untuk daftar task di panel/popup
    });

    var tab;
    try {
      tab = await api.tabs.create({ url: rec.startUrl, active: true });
    } catch (e) {
      await bg.failReplay("gagal membuka tab replay (" + e.message + ").");
      return { ok: false, error: "tab-create-failed" };
    }
    await bg.setReplayState({ tabId: tab.id });

    // Watchdog: bila PAGE_READY tak kunjung datang (redirect klien super cepat
    // sampai content script keburu mati, injection telat, dsb.), coba re-inject
    // lalu jalankan driver langsung — jangan biarkan replay menggantung diam.
    setTimeout(async function () {
      try {
        var s = await T.getSession();
        if (!s.replay || s.replay.status !== "loading" || s.replay.tabId !== tab.id) return;
        try {
          await api.scripting.executeScript({
            target: { tabId: tab.id, allFrames: false },
            files: [
              "shared/util.js",
              "content/overlay.js",
              "content/selector.js",
              "content/recorder.js",
              "content/replayer.js",
              "content/main.js"
            ]
          });
        } catch (e) {
          await bg.failReplay(
            "Halaman replay tidak merespons (content script tidak bisa di-inject). Coba lagi."
          );
          return;
        }
        var s2 = await T.getSession();
        if (!s2.replay || s2.replay.status !== "loading") return;
        await bg.setReplayState({ status: "running" });
        bg.resumeDriver(tab.id);
      } catch (e) {
        /* SW reload di tengah watchdog — biarkan. */
      }
    }, 12000);

    return { ok: true, total: rec.steps.length };
  };

  /** Label pendek satu step untuk daftar task. */
  bg.labelForStep = function (step) {
    var sel = step && step.selector ? step.selector : null;
    var target =
      (sel && (sel.css || (sel.alt && sel.alt[0] && sel.alt[0].css) || "")) || "";
    var text = sel && sel.text ? ' "' + String(sel.text).slice(0, 16) + '"' : "";
    var t = String(target).replace(/\[.*$/, "").slice(0, 24);
    switch (step && step.type) {
      case "navigate":
        return "→ " + String(step.url || step.value || "").replace(/^https?:\/\//, "").slice(0, 30);
      case "input":
        return (step.masked ? "password " : "isi ") + (t || text || "field");
      case "select":
        return "pilih " + (t || "dropdown") + (step.value ? " = " + String(step.value).slice(0, 12) : "");
      case "check":
        return (step.value === "checked" ? "centang " : "lepas ") + (t || "checkbox");
      case "key":
        return "tombol " + String(step.value || "");
      case "click":
        return (step.dblclick ? "klik 2x " : step.button === "right" ? "klik kanan " : "klik ") +
          (text.trim() ? text.trim().slice(0, 18) : t || "elemen");
      default:
        return (step && step.type) || "step";
    }
  };

  /** Ringkasan step untuk pesan error. */
  bg.describeStep = function (step, index) {
    var sel = step && step.selector ? step.selector : {};
    var which =
      sel.css ||
      sel.text ||
      sel.xpath ||
      (sel.alt && sel.alt[0] && sel.alt[0].css) ||
      "(tanpa selector)";
    return "Step " + (index + 1) + " (" + (step && step.type ? step.type : "?") + " → " + which + ")";
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
      await bg.setReplayState({ status: "running" });
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

    var steps = rec.steps;
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

      // ------------------------- navigate -------------------------
      if (step.type === "navigate") {
        var target = step.url || step.value;
        if (!T.isRecordableUrl(target)) {
          await bg.failReplay(bg.describeStep(step, index) + ": URL navigasi tidak valid.", index);
          return;
        }
        await bg.setReplayState({ index: index + 1 }); // step navigate dianggap selesai saat tab.update
        await T.sleep(150); // beri waktu popup/UI melihat progres sebelum navigasi
        try {
          await api.tabs.update(tabId, { url: target });
        } catch (e) {
          await bg.failReplay(bg.describeStep(step, index) + ": gagal membuka URL (" + e.message + ").", index);
          return;
        }
        // Keluar dari loop; kelanjutan dipicu PAGE_READY berikutnya.
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
        var reason = result && result.error ? result.error : "alasan tidak diketahui";
        await bg.failReplay(bg.describeStep(step, index) + ": " + reason + ".", index);
        return;
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
              // Full page load di tab recording → step navigate (URL berubah dari
              // step sebelumnya), atau step pertama kalau buffer masih kosong.
              if (isRecordingTab) {
                var steps = session.pendingSteps || [];
                var last = steps[steps.length - 1];
                var lastUrl = last && last.type === "navigate" ? last.url : session.startUrl;
                if (T.isRecordableUrl(pageUrl) && pageUrl !== lastUrl) {
                  session.pendingSteps.push({
                    type: "navigate",
                    selector: null,
                    value: null,
                    url: pageUrl,
                    delayMs: 0,
                    ts: T.now() - (session.startedAt || T.now())
                  });
                  await T.setSession(session);
                }
              }
              // REC dot di tab mana pun selama sesi recording global aktif dan
              // tab ini adalah tab recording (multi-tab tidak didukung v1).
              if (isRecordingTab) {
                api.tabs
                  .sendMessage(sTabId, { type: "TESTERIA_REC_STATE", recording: true })
                  .catch(function () {});
                // Patch MAIN world per dokumen baru (guard idempoten di dalam
                // file membuat re-inject aman).
                api.scripting
                  .executeScript({
                    target: { tabId: sTabId, allFrames: false },
                    world: "MAIN",
                    files: ["content/spa-main.js"]
                  })
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
            sendResponse(await bg.startReplay(msg.id));
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
            var nextIdx = (ks.replay.index || 0) + 1;
            if (nextIdx >= total) {
              replayDriverActive = false;
              replayDriverIndex = -1;
              await bg.setReplayState({ index: total, status: "done", error: null, startedIndex: null, notice: null });
            } else {
              await bg.setReplayState({ index: nextIdx, status: "running", startedIndex: null, notice: null, pendingPause: null });
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

  // Bersihkan badge & session saat extension dimulai/terpasang ulang.
  api.runtime.onStartup.addListener(function () {
    bg.resetStaleSession().catch(function () {});
  });
  api.runtime.onInstalled.addListener(function () {
    bg.resetStaleSession().catch(function () {});
  });
})();
