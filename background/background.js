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
  importScripts("shared/util.js");
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

    // Pastikan content script hidup di tab target (jalur pemulihan; kalau sudah
    // ada, guard re-inject TESTERIA membuatnya no-op).
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
    if (session.replay && (session.replay.status === "running" || session.replay.status === "paused")) {
      return { ok: false, error: "replay-in-progress" };
    }

    await bg.setReplayState({
      recordingId: rec.id,
      name: rec.name,
      index: 0,           // step berikutnya yang harus dieksekusi (0-based)
      total: rec.steps.length,
      status: "running",
      error: null,
      tabId: null
    });

    var tab = await api.tabs.create({ url: rec.startUrl, active: true });
    await bg.setReplayState({ tabId: tab.id });
    return { ok: true, total: rec.steps.length };
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
   * Lanjutkan replay dari step index pada tab yang baru melapor PAGE_READY.
   * Dipanggil dari REPLAY_PAGE_READY. Serial, satu step per saat.
   */
  bg.runReplayFrom = async function (tabId) {
    var session = await T.getSession();
    var replay = session.replay;
    if (!replay || replay.status !== "running") return;
    if (replay.tabId !== tabId) return; // bukan tab replay

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
      // di tengah jalan. Kalau status bukan running → berhenti total; kalau
      // index digeser (SKIP saat driver masih menunggu) → serahkan eksekusi
      // ke driver baru dari index terbaru.
      var sLive = await T.getSession();
      if (!sLive.replay || sLive.replay.status !== "running" || sLive.replay.tabId !== tabId) {
        replayDriverActive = false;
        replayDriverIndex = -1;
        return;
      }
      if ((sLive.replay.index || 0) !== index) {
        replayDriverActive = false;
        replayDriverIndex = -1;
        bg.runReplayFrom(tabId).catch(function (e) {
          bg.failReplay("Replay terputus: " + (e && e.message ? e.message : e));
        });
        return;
      }

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

      await bg.setReplayState({
        index: index,
        status: "running",
        error: null
      });

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
      var delay = Math.min(2000, Math.max(0, step.delayMs || 0));
      if (delay > 0) await T.sleep(delay);

      // Re-check SETELAH tidur: Pause/Skip bisa terjadi selama driver
      // menunggu delayMs — tanpa ini, step yang di-skip tetap tereksekusi.
      sLive = await T.getSession();
      if (!sLive.replay || sLive.replay.status !== "running" || sLive.replay.tabId !== tabId) {
        replayDriverActive = false;
        replayDriverIndex = -1;
        return;
      }
      if ((sLive.replay.index || 0) !== index) {
        replayDriverActive = false;
        replayDriverIndex = -1;
        bg.runReplayFrom(tabId).catch(function (e) {
          bg.failReplay("Replay terputus: " + (e && e.message ? e.message : e));
        });
        return;
      }

      var result;
      try {
        result = await api.tabs.sendMessage(tabId, {
          type: "TESTERIA_REPLAY_RUN",
          step: step,
          stepNumber: index + 1,
          total: steps.length
        });
      } catch (e) {
        // Content script belum ada (navigasi baru selesai, atau halaman restriktif).
        await bg.failReplay(
          bg.describeStep(step, index) +
            ": content script tidak bisa dihubungi (" +
            (e && e.message ? e.message : "no receiver") +
            ").",
          index
        );
        return;
      }

      if (!result || !result.ok) {
        var reason = result && result.error ? result.error : "alasan tidak diketahui";
        await bg.failReplay(bg.describeStep(step, index) + ": " + reason + ".", index);
        return;
      }

      if (result.needNavigate && step.type === "key" && (step.value === "Enter")) {
        // Enter memicu navigasi form native yang tidak tertangkap sebagai step.
        // Beri kesempatan navigasi berjalan; kelanjutan via PAGE_READY.
        await bg.setReplayState({ index: index + 1 });
        replayDriverActive = false;
        return;
      }

      index += skipNext ? 2 : 1;
      await bg.setReplayState({ index: index });
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
      failedStep: typeof stepIndex === "number" ? stepIndex : null
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
              }
            } else if (
              session.replay &&
              session.replay.status === "running" &&
              session.replay.tabId === sTabId
            ) {
              // Halaman replay selesai load → lanjutkan eksekusi step.
              bg.runReplayFrom(sTabId).catch(function (e) {
                bg.failReplay("Replay terputus: " + (e && e.message ? e.message : e));
              });
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
            if (!rs.replay || rs.replay.status !== "paused" || !rs.replay.tabId) {
              sendResponse({ ok: false, error: "no-paused-replay" });
              return;
            }
            await bg.setReplayState({ status: "running" });
            // Bila driver lama masih hidup (baru akan keluar via liveness
            // check), biarkan dia sendiri melanjutkan — hindari driver ganda.
            if (!bg.replayDriverBusy()) {
              bg.runReplayFrom(rs.replay.tabId).catch(function (e) {
                bg.failReplay("Replay terputus: " + (e && e.message ? e.message : e));
              });
            }
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_REPLAY_SKIP": {
            // Lewati step yang sedang dijeda (mis. user sudah mengisi input
            // secara manual dan tidak ingin step input menimpanya).
            var ks = await T.getSession();
            if (!ks.replay || ks.replay.status !== "paused" || !ks.replay.tabId) {
              sendResponse({ ok: false, error: "no-paused-replay" });
              return;
            }
            var total = ks.replay.total || 0;
            var nextIdx = (ks.replay.index || 0) + 1;
            if (nextIdx >= total) {
              replayDriverActive = false;
              replayDriverIndex = -1;
              await bg.setReplayState({ index: total, status: "done", error: null });
            } else {
              await bg.setReplayState({ index: nextIdx, status: "running" });
              if (!bg.replayDriverBusy()) {
                bg.runReplayFrom(ks.replay.tabId).catch(function (e) {
                  bg.failReplay("Replay terputus: " + (e && e.message ? e.message : e));
                });
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
            bg.runReplayFrom(sender.tab.id).catch(function (e) {
              bg.failReplay("Replay terputus: " + (e && e.message ? e.message : e));
            });
            sendResponse({ ok: true });
            return;
          }

          case "TESTERIA_STOP_REPLAY": {
            sendResponse(await bg.stopReplay());
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
